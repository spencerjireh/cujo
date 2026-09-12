import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import {
  buildAgentSpec,
  buildConverseSpec,
  buildTurnMessage,
  isDocsOnly,
  loadRubric,
  manifestChanged,
  specFingerprint,
} from "../../src/review/agent-spec";

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
});

describe("buildAgentSpec", () => {
  const config = { model: "p/m" } as Config;

  it("passes the rubric through unchanged and gates the accusation alone", () => {
    // Nothing is interpolated any more. The sensor URL was the only placeholder
    // and it went with the tarball (decision 117), so a rubric reaches a session
    // as written — which is also what makes `specFingerprint` a digest of the
    // file rather than of the file plus a deploy's configuration.
    const spec = buildAgentSpec(config, "run /opt/cujo/sniff.py twice");
    expect(spec.model).toEqual({ name: "p/m" });
    expect(spec.instructions).toBe("run /opt/cujo/sniff.py twice");
    // The one line that decides what a human is asked about. `post_blocking_review`
    // is absent on purpose: blocking a merge on a broken test is mechanical and
    // reversible, and asking about it is ceremony (decision 42). `sandbox-mcp`
    // gates nothing, because provisioning a box and running a command in it is
    // what the review *is* (decision 113) — and it says so with an empty list,
    // which means what it says (decision 128).
    expect(spec.mcpServers).toEqual([
      { name: "github-mcp", requireApprovalForTools: ["post_gated_review"] },
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
    expect(converse).not.toContain("post_gated_review");
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
    for (const spec of [buildAgentSpec(config, "r"), buildConverseSpec(config, "r")]) {
      expect(Object.keys(spec.config).sort()).toEqual(["compaction", "iterationLimit"]);
    }
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
