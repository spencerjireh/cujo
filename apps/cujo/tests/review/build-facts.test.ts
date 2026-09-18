import { describe, expect, it } from "vitest";
import {
  buildFactFindings,
  hazardOf,
  parseDockerfile,
  parsePackageJson,
  parsePyproject,
  parseTsupConfig,
  readBuildFacts,
  serviceRoots,
} from "../../src/review/build-facts";

/** This repository's own configs, which are what the rule was written against. */
const CUJO_TSUP = `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  noExternal: [/(.*)/],
  banner: {
    js: "import { createRequire as __cujoCreateRequire } from 'node:module';\\nconst require = __cujoCreateRequire(import.meta.url);",
  },
});
`;

const GITHUB_MCP_TSUP = `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Bundle every dependency into the output so the runtime image needs no
  // node_modules.
  noExternal: [/(.*)/],
});
`;

const HARNESS_TSUP = `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  noExternal: [/^@cujo\\//],
});
`;

const DOCKERFILE = `FROM node:24-slim AS build
WORKDIR /repo
RUN pnpm install --frozen-lockfile --filter @cujo/cujo...
RUN pnpm --filter @cujo/cujo build

FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/cujo/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
`;

/** A reader over `ref:path`; the tree is every path the map holds at that ref. */
function reader(files: Record<string, string>, failTree = false) {
  const reads: string[] = [];
  return {
    reads,
    readFile: async (_repo: string, path: string, ref: string) => {
      reads.push(`${ref}:${path}`);
      return files[`${ref}:${path}`] ?? null;
    },
    tree: async (_repo: string, sha: string) => {
      if (failTree) throw new Error("GitHub /git/trees returned 409");
      return {
        paths: Object.keys(files)
          .filter((key) => key.startsWith(`${sha}:`))
          .map((key) => key.slice(sha.length + 1)),
        truncated: false,
      };
    },
  };
}

const pr = { repo: "o/r", baseSha: "base", headSha: "head", changedFiles: [] as string[] };

describe("serviceRoots", () => {
  const present = new Set([
    "package.json",
    "apps/cujo/package.json",
    "apps/github-mcp/package.json",
    "sandbox/pyproject.toml",
  ]);

  it("takes each changed file's nearest manifest, and each root once", () => {
    expect(
      serviceRoots(present, [
        "apps/cujo/src/review/fold.ts",
        "apps/cujo/tests/review/fold.test.ts",
        "apps/github-mcp/src/index.ts",
        "sandbox/cujo_sniff/report.py",
      ]),
    ).toEqual(["apps/cujo", "apps/github-mcp", "sandbox"]);
  });

  it("falls back to the repository root, which is the empty path", () => {
    expect(serviceRoots(present, ["docs/spec.md"])).toEqual([""]);
  });

  it("gives no root to a change in a repository that declares nothing", () => {
    expect(serviceRoots(new Set(["README.md"]), ["src/a.ts"])).toEqual([]);
  });

  it("stops at eight, because a repository-wide sweep is not worth thirty rows", () => {
    const many = new Set(Array.from({ length: 12 }, (_, i) => `p${i}/package.json`));
    const changed = Array.from({ length: 12 }, (_, i) => `p${i}/src/a.ts`);
    expect(serviceRoots(many, changed)).toHaveLength(8);
  });
});

describe("the config readers", () => {
  it("reads a manifest's name, type and dependency names", () => {
    expect(
      parsePackageJson(
        '{"name":"@cujo/cujo","type":"module","dependencies":{"yaml":"2.5.0","hono":"4"}}',
      ),
    ).toEqual({ name: "@cujo/cujo", type: "module", dependencies: ["hono", "yaml"] });
  });

  it("makes no claim from a manifest a pull request broke", () => {
    expect(parsePackageJson("{ not json")).toBeNull();
    expect(parsePackageJson(null)).toBeNull();
  });

  it("sees the shim on the config that has one and its absence on the ones that do not", () => {
    expect(parseTsupConfig(CUJO_TSUP)).toEqual({
      format: ["esm"],
      bundles: "all",
      requireShim: true,
    });
    expect(parseTsupConfig(GITHUB_MCP_TSUP)).toEqual({
      format: ["esm"],
      bundles: "all",
      requireShim: false,
    });
  });

  it("tells a workspace-only bundle from one that inlines the registry", () => {
    expect(parseTsupConfig(HARNESS_TSUP)?.bundles).toBe("workspace");
  });

  it("reads a config it does not recognise as unknown, never as safe", () => {
    const opaque = 'export default makeConfig({ format: ["esm"], noExternal: BUNDLE_LIST });';
    expect(parseTsupConfig(opaque)?.bundles).toBe("unknown");
    expect(parseTsupConfig("export default {}")).toEqual({
      format: null,
      bundles: "none",
      requireShim: false,
    });
  });

  it("takes the start command from the stage that ships, not from the build", () => {
    expect(parseDockerfile(DOCKERFILE)).toEqual({
      start: '["node", "dist/index.js"]',
      runtimeInstalls: false,
    });
  });

  it("sees a runtime install when the last stage does one", () => {
    const installs = `${DOCKERFILE}RUN pnpm install --prod\n`;
    expect(parseDockerfile(installs)?.runtimeInstalls).toBe(true);
  });

  it("reads a python project's name without a TOML parser", () => {
    expect(parsePyproject('[project]\nname = "cujo-sniff"\nversion = "0"\n')).toBe("cujo-sniff");
    expect(parsePyproject('[tool.ruff]\nname = "not-the-project"\n')).toBeNull();
  });
});

describe("the rule (decision 170)", () => {
  const hazardous = {
    path: "apps/github-mcp",
    name: "@cujo/github-mcp",
    module_type: "module" as const,
    bundler: "tsup" as const,
    format: ["esm"],
    bundles: "all" as const,
    require_shim: false,
    start: '["node", "dist/index.js"]',
    runtime_installs: false,
    python: null,
  };

  it("fires when the change adds a dependency to a shimless ESM bundle", () => {
    const hazard = hazardOf(hazardous, ["yaml"], false);
    expect(hazard?.rule).toBe("esm_bundle_without_require_shim");
    expect(hazard?.path).toBe("apps/github-mcp/package.json");
    expect(hazard?.title).toContain("@cujo/github-mcp");
    expect(hazard?.evidence).toContain("`yaml`");
  });

  it("fires when the change edits the config that bundles them", () => {
    expect(hazardOf(hazardous, [], true)?.rule).toBe("esm_bundle_without_require_shim");
  });

  it("says nothing about a service this pull request only reads", () => {
    expect(hazardOf(hazardous, [], false)).toBeNull();
  });

  it("says nothing when the bundle has the shim", () => {
    expect(hazardOf({ ...hazardous, require_shim: true }, ["yaml"], false)).toBeNull();
  });

  it("says nothing when the bundle leaves its dependencies external", () => {
    expect(hazardOf({ ...hazardous, bundles: "workspace" }, ["yaml"], false)).toBeNull();
    expect(hazardOf({ ...hazardous, bundles: "unknown" }, ["yaml"], false)).toBeNull();
  });

  it("says nothing about a bundle that is not ESM", () => {
    expect(hazardOf({ ...hazardous, format: ["cjs"] }, ["yaml"], false)).toBeNull();
  });

  it("becomes a warn finding the model can add to and cannot drop", () => {
    const hazard = hazardOf(hazardous, ["yaml"], false);
    expect(hazard).not.toBeNull();
    expect(buildFactFindings({ services: [], hazards: [hazard as never] })).toEqual([
      {
        source: "build_fact",
        check: "build",
        severity: "warn",
        title: hazard?.title,
        evidence: hazard?.evidence,
        path: "apps/github-mcp/package.json",
      },
    ]);
  });
});

describe("readBuildFacts", () => {
  const tree = {
    "head:apps/cujo/package.json":
      '{"name":"@cujo/cujo","type":"module","dependencies":{"yaml":"2"}}',
    "head:apps/cujo/tsup.config.ts": CUJO_TSUP,
    "head:apps/cujo/Dockerfile": DOCKERFILE,
    "head:apps/github-mcp/package.json":
      '{"name":"@cujo/github-mcp","type":"module","dependencies":{"zod":"3","yaml":"2"}}',
    "head:apps/github-mcp/tsup.config.ts": GITHUB_MCP_TSUP,
    "head:sandbox/pyproject.toml": '[project]\nname = "cujo-sniff"\n',
    "base:apps/github-mcp/package.json": '{"name":"@cujo/github-mcp","dependencies":{"zod":"3"}}',
  };

  it("describes only the services the change touches", async () => {
    const gh = reader(tree);
    const { facts } = await readBuildFacts(gh, {
      ...pr,
      changedFiles: ["apps/cujo/src/index.ts"],
    });
    expect(facts.services.map((s) => s.path)).toEqual(["apps/cujo"]);
    expect(facts.services[0]).toMatchObject({
      name: "@cujo/cujo",
      module_type: "module",
      bundler: "tsup",
      format: ["esm"],
      bundles: "all",
      require_shim: true,
      start: '["node", "dist/index.js"]',
      runtime_installs: false,
    });
    expect(facts.hazards).toEqual([]);
  });

  it("raises the hazard for a dependency this change added, and names it", async () => {
    const gh = reader(tree);
    const { facts } = await readBuildFacts(gh, {
      ...pr,
      changedFiles: ["apps/github-mcp/package.json", "apps/github-mcp/src/index.ts"],
    });
    expect(facts.hazards).toHaveLength(1);
    expect(facts.hazards[0]?.service).toBe("@cujo/github-mcp");
    expect(facts.hazards[0]?.evidence).toContain("`yaml`");
    // The base manifest is read, and only for the service whose manifest moved.
    expect(gh.reads).toContain("base:apps/github-mcp/package.json");
  });

  it("reads no base manifest for a change that does not touch one, and raises nothing", async () => {
    const gh = reader(tree);
    const { facts } = await readBuildFacts(gh, {
      ...pr,
      changedFiles: ["apps/github-mcp/src/index.ts"],
    });
    expect(gh.reads.some((r) => r.startsWith("base:"))).toBe(false);
    // The service has the hazardous shape, and this change is not its business:
    // an unread base must not read as a base with no dependencies at all, which
    // would make every dependency it already had look newly added.
    expect(facts.services[0]?.require_shim).toBe(false);
    expect(facts.hazards).toEqual([]);
  });

  it("describes a python service with no bundler at all", async () => {
    const gh = reader(tree);
    const { facts } = await readBuildFacts(gh, {
      ...pr,
      changedFiles: ["sandbox/cujo_sniff/report.py"],
    });
    expect(facts.services[0]).toMatchObject({
      path: "sandbox",
      name: null,
      bundler: null,
      bundles: "none",
      python: "cujo-sniff",
    });
  });

  it("is an empty block for a repository that declares no service", async () => {
    const gh = reader({ "head:README.md": "# hi" });
    const { facts } = await readBuildFacts(gh, { ...pr, changedFiles: ["README.md"] });
    expect(facts).toEqual({ services: [], hazards: [] });
    expect(gh.reads).toEqual([]);
  });

  it("says the tree was cut rather than pretending it saw all of it", async () => {
    const gh = {
      readFile: async () => null,
      tree: async () => ({ paths: ["apps/cujo/package.json"], truncated: true }),
    };
    const { facts } = await readBuildFacts(gh, { ...pr, changedFiles: ["apps/cujo/src/a.ts"] });
    expect(facts.tree_truncated).toBe(true);
  });

  it("says the facts are unavailable rather than ending the run", async () => {
    const gh = reader(tree, true);
    const { facts, error } = await readBuildFacts(gh, {
      ...pr,
      changedFiles: ["apps/cujo/src/a.ts"],
    });
    expect(facts).toEqual({ services: [], hazards: [], unavailable: true });
    expect(error).toBeInstanceOf(Error);
  });
});
