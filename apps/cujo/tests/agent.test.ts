import { describe, expect, it } from "vitest";
import { buildAgentSpec, buildTurnMessage, loadRubric, manifestChanged } from "../src/agent";
import type { Config } from "../src/config";

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
});

describe("buildAgentSpec", () => {
  const config = { model: "p/m", sniffUrl: "https://x/sniff.py" } as Config;

  it("injects the sensor URL into the rubric and gates the blocking tool", () => {
    const spec = buildAgentSpec(config, "fetch {{CUJO_SNIFF_URL}} then {{CUJO_SNIFF_URL}}");
    expect(spec.model).toEqual({ name: "p/m" });
    expect(spec.instructions).toBe("fetch https://x/sniff.py then https://x/sniff.py");
    expect(spec.mcpServers).toEqual([
      { name: "github-mcp", requireApprovalForTools: ["post_blocking_review"] },
    ]);
    expect(spec.config).toMatchObject({
      sandbox: { enabled: true },
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
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
    const serialized = JSON.stringify(buildAgentSpec(withSecrets, "rubric {{CUJO_SNIFF_URL}}"));
    expect(serialized).not.toContain("SENTINEL");
    expect(serialized).not.toContain("discordBotToken");
  });

  it("loads the real rubric, which carries the sensor URL placeholder", () => {
    const rubric = loadRubric();
    expect(rubric).toContain("{{CUJO_SNIFF_URL}}");
    expect(buildAgentSpec(config, rubric).instructions).not.toContain("{{CUJO_SNIFF_URL}}");
  });
});
