import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import {
  buildAgentSpec,
  buildTurnMessage,
  loadRubric,
  manifestChanged,
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

  const pr = {
    repo: "o/r",
    prNumber: 7,
    title: "t",
    body: "b",
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    cloneUrl: "https://github.com/o/r.git",
    changedFiles: ["app.py"],
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
});

describe("buildAgentSpec", () => {
  const config = { model: "p/m", sniffTarballUrl: "https://x/src.tar.gz" } as Config;

  it("injects the sensor URL into the rubric and gates the accusation alone", () => {
    const spec = buildAgentSpec(
      config,
      "fetch {{CUJO_SNIFF_TARBALL_URL}} then {{CUJO_SNIFF_TARBALL_URL}}",
    );
    expect(spec.model).toEqual({ name: "p/m" });
    expect(spec.instructions).toBe("fetch https://x/src.tar.gz then https://x/src.tar.gz");
    // The one line that decides what a human is asked about. `post_blocking_review`
    // is absent on purpose: blocking a merge on a broken test is mechanical and
    // reversible, and asking about it is ceremony (decision 42).
    expect(spec.mcpServers).toEqual([
      { name: "github-mcp", requireApprovalForTools: ["post_gated_review"] },
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
    const serialized = JSON.stringify(
      buildAgentSpec(withSecrets, "rubric {{CUJO_SNIFF_TARBALL_URL}}"),
    );
    expect(serialized).not.toContain("SENTINEL");
    expect(serialized).not.toContain("discordBotToken");
  });

  it("loads the real rubric, which carries the sensor URL placeholder", () => {
    const rubric = loadRubric();
    expect(rubric).toContain("{{CUJO_SNIFF_TARBALL_URL}}");
    expect(buildAgentSpec(config, rubric).instructions).not.toContain("{{CUJO_SNIFF_TARBALL_URL}}");
  });

  it("extracts the archive so sniff.py and cujo_sniff land as siblings", () => {
    // Nothing in CI fetches the URL, so the shape of the fetch is only ever
    // checked here. `--strip-components=1` drops the archive's top directory,
    // whose name depends on the branch, and the move puts the whole of
    // sandbox/ in one place -- which is what makes sys.path[0] find the
    // package with no install (decision 46).
    const rubric = loadRubric();
    expect(rubric).toContain("curl -fsSL {{CUJO_SNIFF_TARBALL_URL}} -o /tmp/cujo-src.tgz");
    expect(rubric).toContain("--strip-components=1");
    expect(rubric).toContain("rm -rf /tmp/cujo && mv /tmp/cujo-src/sandbox /tmp/cujo");
  });

  it("delivers the sensors from one archive or not at all", () => {
    // A retry within a turn must not mix two fetches. Staging is cleared
    // first, every step is chained so a failure stops delivery, and the
    // destination is replaced rather than merged into -- otherwise a module
    // deleted upstream survives in /tmp/cujo and gets imported.
    const step = loadRubric().split("2. `git clone")[0];
    expect(step).toContain("rm -rf /tmp/cujo-src /tmp/cujo-src.tgz");
    // No unchained step: every line of the block ends in `&&` bar the last.
    const chain = step
      .split("```")[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(chain.length).toBeGreaterThan(1);
    for (const line of chain.slice(0, -1)) expect(line.endsWith("&&")).toBe(true);
  });
});
