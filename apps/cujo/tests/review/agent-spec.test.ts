import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import {
  buildAgentSpec,
  buildConverseSpec,
  buildDiffSpec,
  buildDiffTurnMessage,
  buildJudgeSpec,
  buildJudgeTurnMessage,
  buildTurnMessage,
  isDocsOnly,
  isDocsPath,
  isLockfilePath,
  loadCheckRubrics,
  loadRubric,
  manifestChanged,
  specFingerprint,
} from "../../src/review/agent-spec";
import type { ReviewPackage } from "../../src/review/prepare";

describe("manifestChanged", () => {
  it("matches dependency manifests and lockfiles at any depth", () => {
    for (const f of [
      "requirements.txt",
      "requirements-dev.txt",
      "svc/pyproject.toml",
      "setup.py",
      "setup.cfg",
      "Pipfile",
      "Pipfile.lock",
      "uv.lock",
      "package.json",
      "web/package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "Cargo.toml",
      "Cargo.lock",
      "go.mod",
      "go.sum",
      "Gemfile",
      "Gemfile.lock",
    ]) {
      expect(manifestChanged([f]), f).toBe(true);
    }
  });

  it("ignores source files and look-alikes", () => {
    for (const f of [
      "app.py",
      "docs/requirements.md",
      "mypackage.json.bak",
      "src/setup.pyi",
      "notes/Cargo.txt",
      "go.mod.orig",
    ]) {
      expect(manifestChanged([f]), f).toBe(false);
    }
    expect(manifestChanged([])).toBe(false);
  });
});

describe("isDocsOnly", () => {
  it("returns true when every file is documentation", () => {
    expect(isDocsOnly(["README.md"])).toBe(true);
    expect(isDocsOnly(["docs/guide.md", "CHANGELOG"])).toBe(true);
    expect(isDocsOnly(["docs/api.rst", "docs/faq.txt", "LICENSE"])).toBe(true);
    expect(isDocsOnly(["CONTRIBUTING.md", "AUTHORS", "NOTICE.md"])).toBe(true);
    expect(isDocsOnly(["deep/nested/README.adoc"])).toBe(true);
  });

  it("returns false when any file is not documentation", () => {
    expect(isDocsOnly(["README.md", "src/app.ts"])).toBe(false);
    expect(isDocsOnly(["app.py"])).toBe(false);
    expect(isDocsOnly(["docs/guide.md", "package.json"])).toBe(false);
  });

  it("returns false when a manifest has a docs-like extension", () => {
    expect(isDocsOnly(["requirements.txt"])).toBe(false);
    expect(isDocsOnly(["README.md", "requirements-dev.txt"])).toBe(false);
    expect(isDocsOnly(["docs/guide.md", "Pipfile"])).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(isDocsOnly([])).toBe(false);
  });

  it("is case-insensitive for extensions", () => {
    expect(isDocsOnly(["NOTES.MD", "guide.TXT"])).toBe(true);
  });

  it("recognises LICENSE variants without an extension", () => {
    expect(isDocsOnly(["LICENSE"])).toBe(true);
    expect(isDocsOnly(["LICENCE"])).toBe(true);
    expect(isDocsOnly(["LICENSE.md"])).toBe(true);
  });
});

describe("the instructions key (decision 155)", () => {
  it("rides in the sandbox brief only when there is something to say", () => {
    const pr = {
      repo: "o/r",
      prNumber: 1,
      title: "t",
      body: "b",
      baseSha: "base",
      headSha: "head",
      cloneUrl: "https://github.com/o/r.git",
      changedFiles: ["a.py"],
      files: [],
      authorLogin: "x",
      authorId: 1,
      authorIsBot: false,
    };
    const guidance = { source: "file" as const, text: "Mind the money math.", truncated: false };
    expect(buildTurnMessage(pr, "", [], guidance)).toContain('"instructions": {');
    expect(buildTurnMessage(pr, "", [], null)).not.toContain("instructions");
  });
});

describe("buildTurnMessage", () => {
  it("wraps the PR facts in a fenced JSON block with the manifest flag", () => {
    const message = buildTurnMessage({
      repo: "o/r",
      prNumber: 7,
      title: "Bump requests",
      body: "Why not.",
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      cloneUrl: "https://github.com/o/r.git",
      changedFiles: ["requirements.txt", "app.py"],

      authorLogin: null,

      authorId: null,
      files: [],
      authorIsBot: false,
    });
    expect(message.startsWith("Review this pull request. Input:\n```json\n")).toBe(true);
    const json = /```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "";
    expect(JSON.parse(json)).toEqual({
      repo: "o/r",
      pr_number: 7,
      pr_title: "Bump requests",
      pr_body: "Why not.",
      base_sha: "b".repeat(40),
      head_sha: "h".repeat(40),
      clone_url: "https://github.com/o/r.git",
      changed_files: ["requirements.txt", "app.py"],
      manifest_changed: true,
    });
  });

  const pr = {
    repo: "o/r",
    prNumber: 7,
    title: "t",
    body: "b",
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    cloneUrl: "https://github.com/o/r.git",
    changedFiles: ["app.py"],

    authorLogin: null,

    authorId: null,
    files: [],
    authorIsBot: false,
  };

  const payloadOf = (message: string) =>
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");

  it("carries run_id when the run has a public page", () => {
    const payload = payloadOf(buildTurnMessage(pr, "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e"));
    expect(payload.run_id).toBe("8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e");
  });

  it("sends no hostname into the turn", () => {
    // An id, not a URL: the turn payload reaches an agent that is about to read
    // a stranger's pull request, so it names no host it could be redirected to.
    const payload = payloadOf(buildTurnMessage(pr, "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e"));
    expect(JSON.stringify(payload)).not.toContain("cujo.");
  });

  it("omits the key entirely when the run has no public page", () => {
    // Absent, not "". The key's absence and the tool's optional field are the
    // same rule, so a private repo needs no special case downstream.
    const payload = payloadOf(buildTurnMessage(pr, ""));
    expect("run_id" in payload).toBe(false);
  });

  it("carries docs_only when every changed file is documentation", () => {
    const docsPr = { ...pr, changedFiles: ["README.md", "docs/guide.rst"] };
    const payload = payloadOf(buildTurnMessage(docsPr));
    expect(payload.docs_only).toBe(true);
    expect(payload.manifest_changed).toBe(false);
  });

  it("omits docs_only when any changed file is code", () => {
    const payload = payloadOf(buildTurnMessage(pr));
    expect("docs_only" in payload).toBe(false);
  });

  it("carries detonation_cached only when there is one (decision 145)", () => {
    expect("detonation_cached" in payloadOf(buildTurnMessage(pr, "", []))).toBe(false);
    const cached = [
      {
        dependency: "humanize==4.9.0",
        source: "pypi" as const,
        run_id: null,
        cached_at: "2026-09-10T00:00:00.000Z",
      },
    ];
    expect(payloadOf(buildTurnMessage(pr, "", cached)).detonation_cached).toEqual(cached);
  });
});

describe("buildAgentSpec", () => {
  const config = { model: "p/m" } as Config;

  it("passes the rubric through unchanged and gates nothing", () => {
    // Nothing is interpolated any more. The sensor URL was the only placeholder
    // and it went with the tarball (decision 117), so a rubric reaches a session
    // as written — which is also what makes `specFingerprint` a digest of the
    // file rather than of the file plus a deploy's configuration.
    const spec = buildAgentSpec(config, "run /opt/cujo/sniff.py twice");
    expect(spec.model).toEqual({ name: "p/m" });
    expect(spec.instructions).toBe("run /opt/cujo/sniff.py twice");
    // Nothing gated on either server (decision 138): a block posts at once
    // and a person lifts it on the pull request. Empty lists mean what they
    // say (decision 128).
    expect(spec.mcpServers).toEqual([
      { name: "github-mcp", requireApprovalForTools: [] },
      { name: "sandbox-mcp", requireApprovalForTools: [] },
    ]);
    expect(spec.config).toEqual({ compaction: { enabled: true }, iterationLimit: 150 });
  });

  it("passes the reasoning effort through, and omits params when it is unset", () => {
    // Absent, not empty. Every key in `params` reaches the provider as-is, and
    // a model that does not reason answers an empty `reasoning_effort` with an
    // error rather than a default (decision 53).
    expect(buildAgentSpec(config, "r").model).toEqual({ name: "p/m" });
    expect("params" in buildAgentSpec(config, "r").model).toBe(false);

    const thinking = { ...config, modelReasoningEffort: "low" } as Config;
    expect(buildAgentSpec(thinking, "r").model).toEqual({
      name: "p/m",
      params: { reasoningEffort: "low" },
    });
  });

  it("carries no server-side secret into the spec the sandbox runs under", () => {
    // The spec defines the session the sandbox runs in, so it is the one place
    // a secret could cross the trust boundary. buildAgentSpec takes only the
    // two fields it needs, which is what keeps this true.
    const withSecrets = {
      ...config,
      discordBotToken: "SENTINEL-DISCORD-TOKEN",
      githubAppPrivateKey: "SENTINEL-PEM",
      githubWebhookSecret: "SENTINEL-HMAC",
    } as unknown as Config;
    const serialized = JSON.stringify(
      buildAgentSpec(withSecrets, "rubric {{CUJO_SNIFF_TARBALL_URL}}"),
    );
    expect(serialized).not.toContain("SENTINEL");
    expect(serialized).not.toContain("discordBotToken");
  });

  it("loads the real rubric, which carries no placeholder at all", () => {
    const rubric = loadRubric();
    // The fetch and its URL are gone with decision 117: the sensors ship in the
    // sandbox image, so there is nothing left to substitute. A `{{…}}` appearing
    // here again would be a placeholder nothing fills.
    expect(rubric).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(buildAgentSpec(config, rubric).instructions).toBe(rubric);
  });

  it("names the sensors where the image actually puts them", () => {
    // The one thing that can silently break a whole review: a path in the rubric
    // that the image does not have. `sandbox/Dockerfile` copies them to
    // /opt/cujo, and nothing checks the two agree except this.
    const rubric = loadRubric();
    expect(rubric).toContain("/opt/cujo/sniff.py");
    expect(rubric).not.toContain("/tmp/cujo/sniff.py");
    // And the tarball machinery is gone rather than merely unused.
    expect(rubric).not.toContain("tar -xzf");
    expect(rubric).not.toContain("cujo-src");
  });
});

describe("buildConverseSpec", () => {
  const config = { model: "p/m" } as Config;

  it("gives the conversation agent no review tools at all", () => {
    // Structural, not prose. The message it reads was written by whoever could
    // reach the pull request, so the bound on a prompt injection is that there
    // is nothing to inject *into*: `apps/cujo` posts the reply afterwards.
    //
    // `sandbox-mcp` is the one server it gets, and it is not a review tool:
    // nothing on it reaches a pull request. `github-mcp` is what must stay
    // absent, and this asserts that rather than an empty list, because the list
    // stopped being empty when the sandbox moved off the harness (113).
    const spec = buildConverseSpec(config, "rubric {{CUJO_SNIFF_TARBALL_URL}}");
    expect(spec.mcpServers).toEqual([{ name: "sandbox-mcp", requireApprovalForTools: [] }]);
    expect(spec.mcpServers?.some((s) => s.name === "github-mcp")).toBe(false);
  });

  it("keeps the sandbox tools, because re-running is the point", () => {
    // Every other reviewer can re-read a diff. Without a sandbox this agent
    // could only paraphrase the report it was handed.
    const spec = buildConverseSpec(config, "rubric");
    expect(spec.mcpServers.map((s) => s.name)).toEqual(["sandbox-mcp"]);
    expect(spec.config).toEqual({ compaction: { enabled: false }, iterationLimit: 60 });
  });

  it("runs at the same reasoning effort as the reviewer", () => {
    // One setting, both agents. A conversation that reasons less than the
    // review it is explaining would contradict it for no stated reason.
    const thinking = { ...config, modelReasoningEffort: "low" } as Config;
    expect(buildConverseSpec(thinking, "rubric").model).toEqual({
      name: "p/m",
      params: { reasoningEffort: "low" },
    });
  });

  it("loads its own rubric, not the reviewer's", () => {
    const converse = loadRubric("CONVERSE.md");
    expect(converse).toContain("/opt/cujo/sniff.py");
    expect(converse).not.toContain("post_blocking_review");
    // The rule the design turns on: a second user message is untrusted too.
    expect(converse).toContain("untrusted");
    expect(buildConverseSpec(config, converse).instructions).not.toContain(
      "{{CUJO_SNIFF_TARBALL_URL}}",
    );
  });

  it("carries no server-side secret either", () => {
    const withSecrets = {
      ...config,
      discordBotToken: "SENTINEL-DISCORD-TOKEN",
      githubAppPrivateKey: "SENTINEL-PEM",
    } as unknown as Config;
    expect(JSON.stringify(buildConverseSpec(withSecrets, "rubric"))).not.toContain("SENTINEL");
  });
});

describe("specFingerprint", () => {
  const config = {
    model: "openrouter/some-model",
    modelReasoningEffort: "",
  } as unknown as Config;

  it("is a sha256 of the instructions, and stable", () => {
    const spec = buildAgentSpec(config, "the rubric");
    expect(specFingerprint(spec)).toMatch(/^[0-9a-f]{64}$/);
    expect(specFingerprint(spec)).toBe(specFingerprint(buildAgentSpec(config, "the rubric")));
  });

  it("changes when the rubric changes", () => {
    expect(specFingerprint(buildAgentSpec(config, "one"))).not.toBe(
      specFingerprint(buildAgentSpec(config, "two")),
    );
  });

  it("is the digest of the rubric as written, with nothing substituted into it", () => {
    // It used to change with the tarball URL, because the URL was interpolated
    // and two deploys pointing at different sensor code were two rubrics. There
    // is no substitution left (decision 117), so the fingerprint is now exactly a
    // digest of the file — and the sensor code's version is the image's, which
    // this deliberately does not try to capture.
    const rubric = "run /opt/cujo/sniff.py and report";
    expect(specFingerprint(buildAgentSpec(config, rubric))).toBe(
      specFingerprint(buildAgentSpec({ ...config } as unknown as Config, rubric)),
    );
  });

  it("is a hex digest", () => {
    expect(specFingerprint(buildAgentSpec(config, "r"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the runtime config both specs run under", () => {
  const config = {
    model: "m",
    modelReasoningEffort: "",
  } as unknown as Config;

  it("compacts the review and never the conversation (decision 129)", () => {
    expect(buildAgentSpec(config, "r").config.compaction).toEqual({ enabled: true });
    // Conversation answers one question against a brief already collected, so
    // it never holds the evidence a compaction would summarise away.
    expect(buildConverseSpec(config, "r").config.compaction).toEqual({ enabled: false });
  });

  it("gives the review more room to iterate than the conversation", () => {
    expect(buildAgentSpec(config, "r").config.iterationLimit).toBe(150);
    expect(buildConverseSpec(config, "r").config.iterationLimit).toBe(60);
  });

  it("carries nothing the harness does not know", () => {
    // The TrueForge keys (`sandbox`, `askUserQuestions`, `generativeUi`,
    // `contextManagement`) are gone with it; the contract's schema is strict.
    expect(Object.keys(buildConverseSpec(config, "r").config).sort()).toEqual([
      "compaction",
      "iterationLimit",
    ]);
    // The two reviews carry a budget (decisions 132, 165); a conversation does not.
    for (const spec of [buildAgentSpec(config, "r"), buildDiffSpec(diffConfig, "r")]) {
      expect(Object.keys(spec.config).sort()).toEqual([
        "compaction",
        "iterationLimit",
        "tokenBudget",
      ]);
    }
  });
});

const diffConfig = {
  model: "p/m",
  modelReasoningEffort: "low",
  modelTemperature: null,
  modelMaxTokens: null,
  diffModel: "p/m",
  diffBudgetTokens: 400_000,
} as unknown as Config;

describe("buildDiffSpec", () => {
  it("has github-mcp alone, ungated, and no sandbox at all", () => {
    const spec = buildDiffSpec(diffConfig, "r");
    expect(spec.mcpServers).toEqual([{ name: "github-mcp", requireApprovalForTools: [] }]);
    expect(JSON.stringify(spec)).not.toContain("sandbox");
  });

  it("does not compact, iterates little, and carries the budget", () => {
    const spec = buildDiffSpec(diffConfig, "r");
    expect(spec.config.compaction).toEqual({ enabled: false });
    expect(spec.config.iterationLimit).toBe(12);
    expect(spec.config.tokenBudget).toBe(400_000);
  });

  it("sends the review model's params when it is the review model, and none otherwise", () => {
    expect(buildDiffSpec(diffConfig, "r").model).toEqual({
      name: "p/m",
      params: { reasoningEffort: "low" },
    });
    // A different model was never tried with those params; they stay home.
    expect(buildDiffSpec({ ...diffConfig, diffModel: "p/flash" }, "r").model).toEqual({
      name: "p/flash",
    });
  });

  it("loads its own rubric, which names the advisory tool and no other", () => {
    const rubric = loadRubric("DIFF.md");
    expect(buildDiffSpec(diffConfig).instructions).toBe(rubric);
    expect(rubric).toContain("post_advisory_review");
    // The other tool appears only in the sentence that forbids it.
    expect(rubric.match(/post_blocking_review/g)?.length).toBe(1);
    expect(rubric).not.toContain("post_gated_review");
    expect(rubric).not.toContain("sandbox_create");
    expect(rubric).not.toContain("sniff.py");
  });

  it("carries no server-side secret either", () => {
    const json = JSON.stringify(
      buildDiffSpec({ ...diffConfig, MODEL_PROVIDER_API_KEY: "sk-leak" } as unknown as Config, "r"),
    );
    expect(json).not.toContain("sk-leak");
  });
});

describe("isDocsPath and isLockfilePath", () => {
  it("tell prose and lockfiles from source", () => {
    expect(isDocsPath("docs/spec.md")).toBe(true);
    expect(isDocsPath("LICENSE")).toBe(true);
    expect(isDocsPath("requirements.txt")).toBe(false);
    expect(isDocsPath("src/a.ts")).toBe(false);
    expect(isLockfilePath("pnpm-lock.yaml")).toBe(true);
    expect(isLockfilePath("services/api/uv.lock")).toBe(true);
    expect(isLockfilePath("package.json")).toBe(false);
  });
});

describe("the sandbox briefs carry the build facts too (decision 171)", () => {
  const prInfo = () => ({
    repo: "o/r",
    prNumber: 7,
    title: "Add yaml",
    body: "",
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    cloneUrl: "https://github.com/o/r.git",
    changedFiles: ["apps/github-mcp/package.json"],
    files: [],
    authorLogin: "x",
    authorId: 1,
    authorIsBot: false,
  });
  const facts = {
    services: [
      {
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
      },
    ],
    hazards: [
      {
        rule: "esm_bundle_without_require_shim" as const,
        service: "@cujo/github-mcp",
        path: "apps/github-mcp/package.json",
        title: "@cujo/github-mcp bundles every dependency into ESM without a require shim",
        evidence: "…",
      },
    ],
  };
  const payload = (message: string) =>
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");

  it("is on the gather brief, which is where a manifest change lands", () => {
    const message = buildTurnMessage(prInfo(), "", [], null, "", 0, facts);
    expect(payload(message).build_facts).toEqual(facts);
  });

  it("is on the judge brief", () => {
    const message = buildJudgeTurnMessage(
      prInfo(),
      "",
      null,
      {
        sandbox: { id: "sbx-1", env: {} },
        policy: { install: "pnpm install", test: "pnpm test" },
        executed: [],
        coverage: { ran: [], skipped: [] },
      },
      24_000,
      facts,
    );
    expect(payload(message).build_facts).toEqual(facts);
  });

  it("is absent from either when a composition reads none", () => {
    expect(payload(buildTurnMessage(prInfo()))).not.toHaveProperty("build_facts");
    const judge = buildJudgeTurnMessage(
      prInfo(),
      "",
      null,
      {
        sandbox: { id: "sbx-1", env: {} },
        policy: {},
        executed: [],
        coverage: { ran: [], skipped: [] },
      },
      24_000,
    );
    expect(payload(judge)).not.toHaveProperty("build_facts");
  });
});

describe("buildDiffTurnMessage", () => {
  const pkg: ReviewPackage = {
    pr: {
      repo: "o/r",
      prNumber: 7,
      title: "Fix rounding",
      body: "Rounds after the discount.",
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      changedFiles: ["app/orders.py", "README.md"],
    },
    diff: {
      kept: [
        {
          path: "app/orders.py",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-a\n+b",
        },
      ],
      omitted: [
        { path: "README.md", status: "modified", additions: 9, deletions: 0, reason: "over_cap" },
      ],
      bytes: 19,
      cap: 20,
    },
    standards: [{ path: "CONTRIBUTING.md", text: "## Standards\n- Pin.", truncated: false }],
    instructions: null,
    previousFindings: [{ severity: "warn", title: "old", path: "app/orders.py", line: 3 }],
    buildFacts: { services: [], hazards: [] },
  };
  const payloadOf = (message: string) =>
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");

  it("wraps the package in the same fence, with the standards, the diff and the memory", () => {
    const message = buildDiffTurnMessage(pkg, "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e");
    expect(message.startsWith("Review this pull request by reading it. Input:\n```json\n")).toBe(
      true,
    );
    expect(payloadOf(message)).toEqual({
      repo: "o/r",
      pr_number: 7,
      pr_title: "Fix rounding",
      pr_body: "Rounds after the discount.",
      base_sha: "b".repeat(40),
      head_sha: "h".repeat(40),
      manifest_changed: false,
      run_id: "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e",
      standards: pkg.standards,
      diff: { files: pkg.diff.kept, omitted: pkg.diff.omitted, bytes: 19, cap: 20 },
      build_facts: { services: [], hazards: [] },
      previous_findings: pkg.previousFindings,
    });
  });

  it("carries the build facts block, hazards and all (decision 170)", () => {
    const facts = {
      services: [
        {
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
        },
      ],
      hazards: [
        {
          rule: "esm_bundle_without_require_shim" as const,
          service: "@cujo/github-mcp",
          path: "apps/github-mcp/package.json",
          title: "@cujo/github-mcp bundles every dependency into ESM without a require shim",
          evidence: "…",
        },
      ],
    };
    const payload = payloadOf(buildDiffTurnMessage({ ...pkg, buildFacts: facts }));
    expect(payload.build_facts).toEqual(facts);
  });

  it("omits run_id and docs_only when neither applies, and carries them when they do", () => {
    const plain = payloadOf(buildDiffTurnMessage(pkg));
    expect(plain).not.toHaveProperty("run_id");
    expect(plain).not.toHaveProperty("docs_only");
    const docs = payloadOf(
      buildDiffTurnMessage({ ...pkg, pr: { ...pkg.pr, changedFiles: ["README.md"] } }),
    );
    expect(docs.docs_only).toBe(true);
  });

  it("sends no clone URL, no hostname and no author into the turn", () => {
    const message = buildDiffTurnMessage(pkg, "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e");
    expect(message).not.toContain("clone_url");
    expect(message).not.toContain("github.com");
    expect(message).not.toContain("author");
  });
});

describe("modelRef, through the specs", () => {
  const bare = {
    model: "vendor/m",
    modelReasoningEffort: "",
    modelTemperature: null,
    modelMaxTokens: null,
  } as unknown as Config;

  it("sends no params at all when nothing is configured", () => {
    // A deploy that sets none of these must produce the request it produced
    // before the settings existed. An empty `params: {}` is not that.
    expect(buildAgentSpec(bare, "r").model).toEqual({ name: "vendor/m" });
    expect(buildConverseSpec(bare, "r").model).toEqual({ name: "vendor/m" });
  });

  it("sends only the keys a deploy asked for", () => {
    const withTemp = { ...bare, modelTemperature: 0 } as unknown as Config;
    expect(buildAgentSpec(withTemp, "r").model.params).toEqual({ temperature: 0 });
    const withMax = { ...bare, modelMaxTokens: 16_000 } as unknown as Config;
    expect(buildAgentSpec(withMax, "r").model.params).toEqual({ maxTokens: 16_000 });
  });

  it("keeps a temperature of zero, which a truthiness test would drop", () => {
    // `0` is the value somebody pinning a temperature most likely wants.
    const zero = { ...bare, modelTemperature: 0 } as unknown as Config;
    expect(buildAgentSpec(zero, "r").model.params?.temperature).toBe(0);
  });

  it("carries all three together when all three are set", () => {
    const all = {
      ...bare,
      modelReasoningEffort: "low",
      modelTemperature: 0.2,
      modelMaxTokens: 8_000,
    } as unknown as Config;
    expect(buildAgentSpec(all, "r").model.params).toEqual({
      reasoningEffort: "low",
      temperature: 0.2,
      maxTokens: 8_000,
    });
  });
});

describe("buildTurnMessage for a private repository (decision 158)", () => {
  it("carries the staging ticket and no clone URL", () => {
    const message = buildTurnMessage(
      {
        repo: "o/r",
        prNumber: 7,
        title: "t",
        body: "b",
        baseSha: "b".repeat(40),
        headSha: "h".repeat(40),
        cloneUrl: "https://github.com/o/r.git",
        changedFiles: ["app.py"],
        authorLogin: null,
        authorId: null,
        files: [],
        authorIsBot: false,
      },
      "",
      [],
      null,
      "0123456789abcdef0123456789abcdef",
    );
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");
    expect(json.staged).toBe("0123456789abcdef0123456789abcdef");
    expect(json).not.toHaveProperty("clone_url");
    expect(message).not.toContain("github.com");
  });
});

describe("the checks' own rubrics (decision 165)", () => {
  const config = { model: "p/m", sandboxBudgetTokens: 3_000_000 } as Config;

  it("hands each check a page a tenth of the parent's, on the common ground", () => {
    const pages = loadCheckRubrics();
    expect(Object.keys(pages).sort()).toEqual(["detonation", "probes", "smoke", "tests"]);
    for (const [name, page] of Object.entries(pages)) {
      expect(page).toContain("sniff.py report --check");
      expect(page).toContain(`Your check is \`${name}\``);
      expect(page.length).toBeLessThan(4000);
    }
    expect(pages.probes).toContain("/tmp/cujo-probes/");
  });

  it("carries them on the sandbox spec, budgeted, and digests them with the rubric", () => {
    const spec = buildAgentSpec(config, "the rubric", { tests: "run the tests" });
    expect(spec.subagents).toEqual({ tests: "run the tests" });
    expect(spec.config.tokenBudget).toBe(3_000_000);
    expect(specFingerprint(spec)).not.toBe(
      specFingerprint(buildAgentSpec(config, "the rubric", { tests: "run them twice" })),
    );
    expect(specFingerprint(spec)).toBe(
      specFingerprint(buildAgentSpec(config, "the rubric", { tests: "run the tests" })),
    );
  });
});

describe("the judge spec and brief (decision 161)", () => {
  const pr = {
    repo: "o/r",
    prNumber: 7,
    title: "t",
    body: "b",
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    cloneUrl: "https://github.com/o/r.git",
    changedFiles: ["app.py"],
    authorLogin: null,
    authorId: null,
    files: [],
    authorIsBot: false,
  };
  const judge = {
    sandbox: { id: "sbx-1", env: { HTTP_PROXY: "http://127.0.0.1:8899" } },
    policy: { install: "pip install -e .", test: "pytest -q" },
    executed: [{ check: "tests", report: { check: "tests", base_pass_head_fail: [], runs: [] } }],
    coverage: { ran: [{ check: "tests", note: "2 on base and 2 on head" }], skipped: [] },
  };

  it("carries the box, the policy, the reports and the coverage, and no clone URL", () => {
    const message = buildJudgeTurnMessage(pr, "run-1", null, judge, 24_000);
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");
    expect(json.sandbox).toEqual(judge.sandbox);
    expect(json.policy).toEqual(judge.policy);
    expect(json.executed.tests).toEqual({ report: judge.executed[0]?.report, truncated: false });
    expect(json.coverage).toEqual(judge.coverage);
    expect(json.run_id).toBe("run-1");
    expect(json).not.toHaveProperty("clone_url");
    expect(json).not.toHaveProperty("staged");
  });

  it("cuts a report over the byte cap and says so", () => {
    const big = { check: "tests", runs: [{ stdout_tail: "x".repeat(5000) }] };
    const message = buildJudgeTurnMessage(
      pr,
      "",
      null,
      { ...judge, executed: [{ check: "tests", report: big }] },
      200,
    );
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(message)?.[1] ?? "{}");
    expect(json.executed.tests.truncated).toBe(true);
    expect(typeof json.executed.tests.report).toBe("string");
    expect(json.executed.tests.report.length).toBeLessThan(300);
  });

  it("is its own spec on its own rubric, with both servers", () => {
    const spec = buildJudgeSpec(
      {
        model: "p/m",
        modelReasoningEffort: "",
        modelTemperature: null,
        modelMaxTokens: null,
        sandboxBudgetTokens: 3_000_000,
      },
      "# judge",
      { probes: "probe it" },
    );
    expect(spec.instructions).toBe("# judge");
    expect(spec.mcpServers.map((s) => s.name)).toEqual(["github-mcp", "sandbox-mcp"]);
    expect(spec.config?.iterationLimit).toBe(80);
    expect(spec.config?.tokenBudget).toBe(3_000_000);
    expect(spec.subagents).toEqual({ probes: "probe it" });
  });
});
