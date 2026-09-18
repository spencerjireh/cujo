import { describe, expect, it } from "vitest";
import type { BuildFacts } from "../../src/review/build-facts";
import { Store } from "../../src/store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

const facts: BuildFacts = {
  services: [
    {
      path: "apps/github-mcp",
      name: "@cujo/github-mcp",
      module_type: "module",
      bundler: "tsup",
      format: ["esm"],
      bundles: "all",
      require_shim: false,
      start: '["node", "dist/index.js"]',
      runtime_installs: false,
      python: null,
    },
  ],
  hazards: [
    {
      rule: "esm_bundle_without_require_shim",
      service: "@cujo/github-mcp",
      path: "apps/github-mcp/package.json",
      title: "@cujo/github-mcp bundles every dependency into ESM without a require shim",
      evidence: "…",
    },
  ],
};

describe("the build facts a run was briefed with (decision 170)", () => {
  it("gives back what the brief carried, so a refold derives the same findings", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.buildFacts.putForRun(run.id, facts, "2026-09-19T10:00:00.000Z");
    expect(store.buildFacts.forRun(run.id)).toEqual(facts);
  });

  it("replaces on a re-run rather than keeping two answers for one run", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.buildFacts.putForRun(run.id, facts, "2026-09-19T10:00:00.000Z");
    store.buildFacts.putForRun(run.id, { services: [], hazards: [] }, "2026-09-19T10:05:00.000Z");
    expect(store.buildFacts.forRun(run.id)).toEqual({ services: [], hazards: [] });
  });

  it("is null for a run that read none, which is not the same as reading nothing", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    expect(store.buildFacts.forRun(run.id)).toBeNull();
    store.buildFacts.putForRun(run.id, { services: [], hazards: [] }, "t0");
    expect(store.buildFacts.forRun(run.id)).toEqual({ services: [], hazards: [] });
  });
});
