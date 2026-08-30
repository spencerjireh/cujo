import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { PullRequestInfo } from "../clients/github";
import type { Config } from "../config";

const MANIFESTS = [
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)setup\.(py|cfg)$/,
  /(^|\/)Pipfile(\.lock)?$/,
  /(^|\/)uv\.lock$/,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.(toml|lock)$/,
  /(^|\/)go\.(mod|sum)$/,
  /(^|\/)Gemfile(\.lock)?$/,
];

export function manifestChanged(files: readonly string[]): boolean {
  return files.some((f) => MANIFESTS.some((re) => re.test(f)));
}

const DOCS_EXTENSIONS = /\.(md|txt|rst|adoc|asciidoc)$/i;
const DOCS_BASENAMES =
  /^(LICENSE|LICENCE|CHANGELOG|AUTHORS|CONTRIBUTORS|CODEOWNERS|NOTICE)(\..*)?$/i;

/**
 * True when every changed file is documentation — prose that cannot break a
 * build, a test, or a dependency. The agent uses this to choose
 * `post_advisory_review` over `post_blocking_review` (decision 79).
 *
 * An empty list is not docs-only: a PR with no files is a metadata change,
 * and treating it as advisory would hide a label or title manipulation from
 * a review that was meant to judge it.
 *
 * A file that matches `MANIFESTS` is never documentation, even if its
 * extension looks like prose (`requirements.txt`).
 */
export function isDocsOnly(files: readonly string[]): boolean {
  if (files.length === 0) return false;
  return files.every((f) => {
    if (MANIFESTS.some((re) => re.test(f))) return false;
    const base = f.split("/").pop() ?? "";
    return DOCS_EXTENSIONS.test(base) || DOCS_BASENAMES.test(base);
  });
}

/**
 * The rubric lives in agent/SKILL.md at the repo root so a reader (and Qodo)
 * can review it as prose. The Dockerfile copies it next to dist/.
 *
 * The candidates are a chain, not alternatives, and two of them are load
 * bearing for different environments: the four-level one is this source file
 * reaching the repo root in dev and test, and the one-level one is the bundle
 * at /app/dist reaching /app/agent in the container. Neither covers the other,
 * so neither may be dropped when this file moves.
 */
export function loadRubric(name = "SKILL.md"): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // src/review -> apps/cujo/src -> apps/cujo -> apps -> repo root.
    resolve(here, `../../../../agent/${name}`),
    // dist -> /app, which is where the Dockerfile puts agent/.
    resolve(here, `../agent/${name}`),
    resolve(here, `agent/${name}`),
    resolve(process.cwd(), `agent/${name}`),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // Try the next location.
    }
  }
  throw new Error(`agent/${name} not found`);
}

/**
 * A digest of the instructions a spec would hand a session.
 *
 * Of the substituted string, not of `agent/SKILL.md` on disk: the tarball URL
 * is spliced in by `buildAgentSpec`, so two deploys pointing at different
 * sensor code are two different rubrics and have to hash differently.
 *
 * Recorded on a run so a verdict can be traced to the wording that produced it.
 * See `RunRecord.rubricSha256` for the caveat about which session that is
 * actually true of.
 */
export function specFingerprint(spec: TrueForgeApi.AgentSpec): string {
  return createHash("sha256")
    .update(spec.instructions ?? "")
    .digest("hex");
}

/**
 * The spec defines the session the sandbox runs under, so it is the one place
 * a server-side secret could cross the trust boundary. It takes only the two
 * fields it needs rather than the whole `Config`, which turns a future
 * `...config` spread into a compile error instead of a leak.
 */
/**
 * The model both specs run under.
 *
 * **Every key in `params` is forwarded to the provider as-is**, so an unset
 * setting has to mean an absent key and never a default. A model that does not
 * reason answers an empty `reasoning_effort` with an error rather than a
 * default, and some reasoning models reject `temperature` outright or take only
 * `1` — and the failure that produces is the invisible one decision 56 exists
 * to prevent: the process boots, `/readyz` is green, and every webhook answers
 * 502. Nothing in CI catches it, because the contract suite runs against a stub
 * model provider.
 *
 * So `params` is omitted entirely when nothing is configured, and each key
 * appears only when a deploy asked for it. Determinism is worth having, but it
 * is worth having as something an operator turns on once they know their
 * provider accepts it.
 */
function modelRef(
  config: Pick<Config, "model" | "modelReasoningEffort" | "modelTemperature" | "modelMaxTokens">,
): TrueForgeApi.Model {
  const params: TrueForgeApi.ModelParams = {
    ...(config.modelReasoningEffort ? { reasoningEffort: config.modelReasoningEffort } : {}),
    // `!= null` and not a truthiness test: `temperature: 0` is the setting
    // somebody reaching for this most likely wants, and `0` is falsy.
    ...(config.modelTemperature != null ? { temperature: config.modelTemperature } : {}),
    ...(config.modelMaxTokens != null ? { maxTokens: config.modelMaxTokens } : {}),
  };
  return Object.keys(params).length > 0 ? { name: config.model, params } : { name: config.model };
}

export function buildAgentSpec(
  config: Pick<
    Config,
    | "model"
    | "modelReasoningEffort"
    | "modelTemperature"
    | "modelMaxTokens"
    | "sniffTarballUrl"
    | "compactionThresholdTokens"
  >,
  rubric = loadRubric(),
): TrueForgeApi.AgentSpec {
  return {
    model: modelRef(config),
    instructions: rubric.replaceAll("{{CUJO_SNIFF_TARBALL_URL}}", config.sniffTarballUrl),
    // The one gated tool, and the one line that decides what a human is asked
    // about. `post_blocking_review` is deliberately not here: blocking a merge
    // on a broken test is mechanical and reversible, and asking about it is
    // ceremony. Only the accusation waits (decision 42).
    mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_gated_review"] }],
    config: {
      // `fileDownloads` is on by default and would let a file written inside
      // the box be fetched back out through the harness's download endpoint.
      // Nothing in this design ever does that — a check report comes back as
      // text on a thread event — so the crossing is closed rather than left
      // open because nobody has asked.
      sandbox: { enabled: true, fileDownloads: false },
      // Raised well above the harness default of 50,000. The parent holds four
      // full check reports and then writes the review body from them, so a
      // compaction in between is a review argued from a summary of the
      // evidence. The hard rules survive it either way — Cujo re-derives those
      // from the reports on its own side — but the prose would not.
      contextManagement: {
        compaction: { enabled: true, compactionThresholdTokens: config.compactionThresholdTokens },
      },
      // The review runs headless; nothing can answer a question or view a card.
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
      iterationLimit: 150,
    },
  };
}

/**
 * The agent that answers `@cujo-guard` (Design 3).
 *
 * Two differences from the reviewer, and both are the design:
 *
 * `mcpServers: []` — **no review tools at all**, structurally rather than by
 * prose. The message this agent reads was written by whoever could reach the
 * pull request, so it is an untrusted-instruction channel published to the
 * internet. With no tool that can write to GitHub, the worst a prompt injection
 * achieves is a wasted sandbox. `apps/cujo` posts the reply itself, after the
 * turn ends, from the final assistant message.
 *
 * `sandbox.enabled` stays true. Re-execution is the whole point — every other
 * review bot can re-read a diff, and only this one still has the recipe — so
 * removing the sandbox would leave a conversation agent that can only
 * paraphrase the report it was handed.
 */
export function buildConverseSpec(
  config: Pick<
    Config,
    "model" | "modelReasoningEffort" | "modelTemperature" | "modelMaxTokens" | "sniffTarballUrl"
  >,
  rubric = loadRubric("CONVERSE.md"),
): TrueForgeApi.AgentSpec {
  return {
    model: modelRef(config),
    instructions: rubric.replaceAll("{{CUJO_SNIFF_TARBALL_URL}}", config.sniffTarballUrl),
    mcpServers: [],
    config: {
      // Closed here too, and for the same reason. No `contextManagement`: this
      // answers one question against a brief already collected, so it never
      // holds the evidence a compaction would summarise away.
      sandbox: { enabled: true, fileDownloads: false },
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
      // Lower than the review's 150: this answers one question against a brief
      // that is already collected, and a conversation that needs a hundred
      // steps has misunderstood what it was asked.
      iterationLimit: 60,
    },
  };
}

/**
 * Contract 1 step 3: the single user message that starts a turn.
 *
 * `runId` is this run's id when it has a public page and `""` when it does not,
 * and the key is left out of the payload entirely in the second case
 * (decision 36). Omitting rather than sending `""` keeps one rule at both ends:
 * the key is absent and `run_id` is optional on the review tool, so a private
 * repo's review needs no special case anywhere downstream.
 *
 * It is an id rather than a URL so that nothing the agent reads in the pull
 * request can choose the host the review's footer points at; `github-mcp` owns
 * that.
 */
export function buildTurnMessage(pr: PullRequestInfo, runId = ""): string {
  const docsOnly = isDocsOnly(pr.changedFiles);
  const payload = {
    repo: pr.repo,
    pr_number: pr.prNumber,
    pr_title: pr.title,
    pr_body: pr.body,
    base_sha: pr.baseSha,
    head_sha: pr.headSha,
    clone_url: pr.cloneUrl,
    changed_files: pr.changedFiles,
    manifest_changed: manifestChanged(pr.changedFiles),
    ...(docsOnly ? { docs_only: true } : {}),
    ...(runId ? { run_id: runId } : {}),
  };
  return `Review this pull request. Input:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
