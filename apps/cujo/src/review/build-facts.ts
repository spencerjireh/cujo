/**
 * What a pull request's services are built into (decision 170).
 *
 * The diff review reads code. It has never known how that code is packaged,
 * and the one outage this reviewer has caused came from exactly there: a
 * CommonJS dependency bundled into an ESM output, which threw on the first
 * line of the container and was reviewed eight times without being seen. A
 * reader cannot find that in a diff, because the fact that makes it a defect
 * is in a bundler config the diff may not even touch.
 *
 * So the trusted side reads the packaging and hands it over as facts, the way
 * it already hands over the diff and the standards (decision 134). Two rules
 * govern what follows.
 *
 * **Read, never run.** `tsup.config.ts` is TypeScript from a pull request.
 * Importing it would execute an untrusted file in the trusted zone, which is
 * the crossing this whole architecture exists to prevent, so every config here
 * is matched as text. A config that does not match reads as `unknown` and
 * never as safe: the rule below fires on what was positively read, and an
 * unreadable config simply produces no claim.
 *
 * **Head, not base.** Every other reader on this path takes the base commit
 * (`readStandards`, `readInstructions`, `.cujo.yml`), because what a pull
 * request may be *held to* is decided by the branch it targets (decision 13).
 * Build facts are the opposite kind of thing: they describe what this change
 * *produces*, so they are read from the change. The one base read is a
 * service's `package.json`, and only to tell an added dependency from a
 * bumped one.
 */

import type { GitHubReader } from "../clients/github";
import type { Finding } from "./types";

/** The `check` every build-fact finding carries; not one of the sandbox's. */
const BUILD_CHECK = "build";

/**
 * How many services one pull request may produce facts for. A change that
 * touches more than eight is a repository-wide sweep, and the brief is better
 * spent on the diff than on thirty near-identical rows.
 */
const MAX_SERVICES = 8;

/**
 * A config file larger than this is left unread rather than cut. Cutting is
 * what every other reader here does (`cut` in `prepare.ts`), and it is wrong
 * for this one: half a `package.json` does not parse, and half a Dockerfile
 * can drop the `CMD` that the fact is about.
 */
const MAX_CONFIG_BYTES = 256_000;

/** Where a bundler config lives, in the order the reader accepts one. */
const TSUP_CONFIGS = [
  "tsup.config.ts",
  "tsup.config.mts",
  "tsup.config.js",
  "tsup.config.mjs",
] as const;

const NEXT_CONFIGS = ["next.config.ts", "next.config.mjs", "next.config.js"] as const;

/** What a service bundles into its output, as `noExternal` declares it. */
type Bundles = "all" | "workspace" | "none" | "unknown";

/** One service's packaging, as the brief carries it. Snake case: this is model-facing. */
export interface BuildFact {
  /** The directory the service's manifest sits in; "" for a repository root. */
  path: string;
  name: string | null;
  /** `package.json`'s `type`. Absent means Node's default, CommonJS. */
  module_type: "module" | "commonjs" | null;
  bundler: "tsup" | "next" | null;
  /** The bundler's output formats, as declared. */
  format: string[] | null;
  bundles: Bundles;
  /** Whether the bundle gives itself a real `require` (decision 168). */
  require_shim: boolean | null;
  /** The image's `CMD`, verbatim, when the service has a Dockerfile. */
  start: string | null;
  /** Whether the runtime stage installs or copies `node_modules`. */
  runtime_installs: boolean | null;
  /** `pyproject.toml`'s project name, when the service is a Python one. */
  python: string | null;
}

/** The one rule this slice derives. */
type BuildRule = "esm_bundle_without_require_shim";

/** A hazard the facts prove, stated once and carried both ways. */
export interface BuildHazard {
  rule: BuildRule;
  service: string;
  path: string;
  title: string;
  evidence: string;
}

/** The `build_facts` block of the diff brief (Contract 11). */
export interface BuildFacts {
  services: BuildFact[];
  hazards: BuildHazard[];
  /** GitHub cut the tree listing, so a service may be missing from `services`. */
  tree_truncated?: true;
  /** The tree could not be read at all; these facts are empty, not absent. */
  unavailable?: true;
}

export interface BuildFactsSubject {
  repo: string;
  baseSha: string;
  headSha: string;
  changedFiles: readonly string[];
}

type Reader = Pick<GitHubReader, "readFile" | "tree">;

/**
 * The facts for every service this pull request touches.
 *
 * A failed read does not end the run, which is the one place this reader
 * departs from `readStandards`. A review with no standards would be judging
 * against the model's taste and is worth stopping for; a review with no build
 * facts is the review this repository posted all week. The block says
 * `unavailable` instead, so the model is told the facts are missing rather
 * than told there are none.
 */
export async function readBuildFacts(
  github: Reader,
  pr: BuildFactsSubject,
): Promise<{ facts: BuildFacts; error?: unknown }> {
  let listing: { paths: string[]; truncated: boolean };
  try {
    listing = await github.tree(pr.repo, pr.headSha);
  } catch (error) {
    return { facts: { services: [], hazards: [], unavailable: true }, error };
  }
  const present = new Set(listing.paths);
  const roots = serviceRoots(present, pr.changedFiles);
  const services: BuildFact[] = [];
  const hazards: BuildHazard[] = [];
  try {
    for (const root of roots) {
      const service = await readService(github, pr, root, present);
      services.push(service.fact);
      const hazard = hazardOf(service.fact, service.addedDependencies, service.configChanged);
      if (hazard) hazards.push(hazard);
    }
  } catch (error) {
    return { facts: { services, hazards, unavailable: true }, error };
  }
  return {
    facts: {
      services,
      hazards,
      ...(listing.truncated ? { tree_truncated: true as const } : {}),
    },
  };
}

/**
 * The service directories the change lands in: for each changed file, the
 * nearest ancestor holding a manifest. A file with no manifest above it
 * belongs to no service and contributes nothing.
 */
export function serviceRoots(
  present: ReadonlySet<string>,
  changedFiles: readonly string[],
): string[] {
  const roots = new Set<string>();
  for (const file of changedFiles) {
    const root = nearestRoot(present, file);
    if (root !== null) roots.add(root);
  }
  return [...roots].sort().slice(0, MAX_SERVICES);
}

function nearestRoot(present: ReadonlySet<string>, file: string): string | null {
  const parts = file.split("/");
  // From the file's own directory up to the repository root, which is "".
  for (let depth = parts.length - 1; depth >= 0; depth -= 1) {
    const dir = parts.slice(0, depth).join("/");
    if (present.has(join(dir, "package.json")) || present.has(join(dir, "pyproject.toml"))) {
      return dir;
    }
  }
  return null;
}

function join(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

interface ServiceRead {
  fact: BuildFact;
  /** Dependency names in head's `dependencies` that base did not have. */
  addedDependencies: string[];
  /** The change edits this service's bundler config. */
  configChanged: boolean;
}

async function readService(
  github: Reader,
  pr: BuildFactsSubject,
  root: string,
  present: ReadonlySet<string>,
): Promise<ServiceRead> {
  const changed = new Set(pr.changedFiles);
  const manifestPath = join(root, "package.json");
  const head = present.has(manifestPath)
    ? parsePackageJson(await read(github, pr.repo, manifestPath, pr.headSha))
    : null;

  // Only when the change touches the manifest: every other pull request would
  // be paying a request to learn nothing -- and, before this was a condition
  // on the difference too, an unread base read as a base with no dependencies,
  // which made every dependency a service already had look newly added.
  const manifestChanged = changed.has(manifestPath);
  const base = manifestChanged
    ? parsePackageJson(await read(github, pr.repo, manifestPath, pr.baseSha))
    : null;
  const addedDependencies =
    manifestChanged && head
      ? head.dependencies.filter((name) => !(base?.dependencies ?? []).includes(name))
      : [];

  const tsupPath = TSUP_CONFIGS.map((f) => join(root, f)).find((p) => present.has(p)) ?? null;
  const nextPath = NEXT_CONFIGS.map((f) => join(root, f)).find((p) => present.has(p)) ?? null;
  const bundler = tsupPath ? ("tsup" as const) : nextPath ? ("next" as const) : null;
  const config = tsupPath
    ? parseTsupConfig(await read(github, pr.repo, tsupPath, pr.headSha))
    : null;

  const dockerfilePath = join(root, "Dockerfile");
  const image = present.has(dockerfilePath)
    ? parseDockerfile(await read(github, pr.repo, dockerfilePath, pr.headSha))
    : null;

  const pyprojectPath = join(root, "pyproject.toml");
  const python = present.has(pyprojectPath)
    ? parsePyproject(await read(github, pr.repo, pyprojectPath, pr.headSha))
    : null;

  return {
    fact: {
      path: root,
      name: head?.name ?? null,
      module_type: head?.type ?? null,
      bundler,
      format: config?.format ?? null,
      bundles: config ? config.bundles : bundler === null ? "none" : "unknown",
      require_shim: config ? config.requireShim : null,
      start: image?.start ?? null,
      runtime_installs: image ? image.runtimeInstalls : null,
      python,
    },
    addedDependencies,
    configChanged: tsupPath !== null && changed.has(tsupPath),
  };
}

/** A config file's text, or null when it is absent or too large to trust whole. */
async function read(
  github: Reader,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const text = await github.readFile(repo, path, ref);
  if (text === null) return null;
  return Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES ? null : text;
}

interface PackageJson {
  name: string | null;
  type: "module" | "commonjs" | null;
  dependencies: string[];
}

export function parsePackageJson(text: string | null): PackageJson | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A manifest a pull request broke is not a manifest to make claims from.
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const deps = o.dependencies;
  return {
    name: typeof o.name === "string" ? o.name : null,
    type: o.type === "module" ? "module" : o.type === "commonjs" ? "commonjs" : null,
    dependencies:
      deps !== null && typeof deps === "object" && !Array.isArray(deps)
        ? Object.keys(deps as Record<string, unknown>).sort()
        : [],
  };
}

interface TsupConfig {
  format: string[] | null;
  bundles: Bundles;
  requireShim: boolean;
}

/**
 * A tsup config, read as text and never as code.
 *
 * Three questions, and each is answered only when the file says so plainly.
 * `noExternal: [/(.*)/]` is every dependency inlined; a pattern anchored on a
 * scope (`/^@cujo\//`) is the workspace's own packages and nothing from the
 * registry. Anything else is `unknown`, which is not a hazard and not a
 * clearance -- it is the reader saying it could not tell.
 */
export function parseTsupConfig(text: string | null): TsupConfig | null {
  if (text === null) return null;
  const formatList = /\bformat\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? null;
  const format =
    formatList === null
      ? null
      : [...formatList.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1] as string);
  const noExternal = /\bnoExternal\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? null;
  return {
    format,
    // A `noExternal` this reader could not take apart is `unknown` and not
    // `none`: "bundles nothing" is a clearance, and the reader has not earned
    // one here.
    bundles:
      noExternal === null && /\bnoExternal\s*:/.test(text) ? "unknown" : bundlesOf(noExternal),
    // `createRequire` anywhere in the config is the banner of decision 168;
    // there is no other reason for the name to appear in one.
    requireShim: /createRequire/.test(text),
  };
}

function bundlesOf(noExternal: string | null): Bundles {
  if (noExternal === null) return "none";
  const body = noExternal.trim();
  if (body === "") return "none";
  // `/(.*)/` and `/.*/` match every specifier there is.
  if (/\/\(?\.[*+]\)?\//.test(body)) return "all";
  // Anchored on a scope: the workspace's own packages, nothing from a registry.
  if (/\/\^@[\w-]+/.test(body)) return "workspace";
  // A list of names, a pattern this reader does not recognise, or something it
  // cannot tell apart from either. Not a clearance: the rule below needs
  // `all`, and says nothing about a service it could not read.
  return "unknown";
}

interface ImageFacts {
  start: string | null;
  runtimeInstalls: boolean;
}

/**
 * The image's last stage: what it starts, and whether it installs anything.
 * The last `FROM` begins the stage that ships, so an install in an earlier
 * build stage is not a runtime install and does not count.
 */
export function parseDockerfile(text: string | null): ImageFacts | null {
  if (text === null) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let lastFrom = -1;
  for (const [index, line] of lines.entries()) {
    if (/^\s*FROM\s/i.test(line)) lastFrom = index;
  }
  const runtime = lines.slice(lastFrom + 1);
  let start: string | null = null;
  let runtimeInstalls = false;
  for (const line of runtime) {
    const cmd = /^\s*CMD\s+(.*\S)\s*$/i.exec(line);
    if (cmd?.[1]) start = cmd[1];
    if (/^\s*RUN\s.*\b(npm|pnpm|yarn)\s+(install|ci|add)\b/i.test(line)) runtimeInstalls = true;
    if (/^\s*COPY\s.*node_modules/i.test(line)) runtimeInstalls = true;
  }
  return { start, runtimeInstalls };
}

/** A `pyproject.toml`'s project name, without a TOML parser for one scalar. */
export function parsePyproject(text: string | null): string | null {
  if (text === null) return null;
  const body = text.replace(/\r\n?/g, "\n");
  const project = /^\[project\]$/m.exec(body);
  if (!project) return null;
  const rest = body.slice(project.index);
  return /^name\s*=\s*["']([^"']+)["']/m.exec(rest)?.[1] ?? null;
}

/** The half of the rule's evidence that is about the bundle, not the change. */
const SHIMLESS_BUNDLE =
  'Its tsup config declares `format: ["esm"]` with `noExternal` matching every specifier, ' +
  "and carries no `createRequire` banner, so any bundled dependency that calls `require` " +
  'at load throws `Dynamic require of "..." is not supported` and the container exits on ' +
  "its first line.";

/** What to do about it; the rule is a signal to check, not a proof (decision 170). */
const CHECK_THE_ENTRY_POINTS =
  "Check that each added dependency ships an ES module entry point, or give the bundle a " +
  "`createRequire` banner as `apps/cujo` has (decision 168).";

/**
 * The rule (decision 170). A service that inlines every dependency into an
 * ESM bundle and gives that bundle no `require` will throw on its first line
 * the moment one of those dependencies is CommonJS -- which is not visible in
 * the dependency's name, its version, or any line of the diff.
 *
 * It fires on a change, not on a shape: the shape is true of three services in
 * this repository on every pull request, and a finding that is always there is
 * a finding nobody reads. What makes it this pull request's business is adding
 * a dependency to that service, or editing the config that bundles them.
 *
 * `dependencies` only. A `devDependencies` entry can be imported by the code
 * being bundled too, but saying so on every tooling bump is the noise this
 * rule is built to avoid; the narrower claim is the one worth making first.
 */
export function hazardOf(
  fact: BuildFact,
  addedDependencies: readonly string[],
  configChanged: boolean,
): BuildHazard | null {
  const esm = (fact.format ?? []).includes("esm");
  if (!esm || fact.bundles !== "all" || fact.require_shim === true) return null;
  if (addedDependencies.length === 0 && !configChanged) return null;
  const service = fact.name ?? (fact.path || "this repository");
  const cause =
    addedDependencies.length > 0
      ? `this pull request adds ${addedDependencies.map((d) => `\`${d}\``).join(", ")} to its \`dependencies\``
      : "this pull request edits its bundler config";
  return {
    rule: "esm_bundle_without_require_shim",
    service,
    path: join(fact.path, "package.json"),
    title: `${service} bundles every dependency into ESM without a require shim`,
    evidence: `${SHIMLESS_BUNDLE} ${cause[0]?.toUpperCase()}${cause.slice(1)}. ${CHECK_THE_ENTRY_POINTS}`,
  };
}

/**
 * The same hazards as findings, derived on the trusted side so the record
 * carries them whether or not the model repeated them (decision 21's shape,
 * applied to a fact the reader can reproduce).
 */
export function buildFactFindings(facts: BuildFacts): Finding[] {
  return facts.hazards.map((hazard) => ({
    source: "build_fact" as const,
    check: BUILD_CHECK,
    severity: "warn" as const,
    title: hazard.title,
    evidence: hazard.evidence,
    path: hazard.path,
  }));
}
