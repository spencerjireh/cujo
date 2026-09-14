/**
 * A review against a local bare repository and a fake `ocr` on PATH. Real git
 * throughout: the refusals are about what git says, not what a mock says.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { execFileNoShell } from "../src/exec";
import type { ReviewRequest } from "../src/request";
import { createReviewer } from "../src/review";

const ENVELOPE = { status: "success", comments: [{ path: "a.txt", severity: "low" }] };

/** A repository with two commits and `refs/pull/1/head` at the second. */
function origin(): { url: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "ocr-origin-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  mkdirSync(join(dir, ".opencodereview"));
  writeFileSync(join(dir, ".opencodereview", "rule.json"), "{}");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "a.txt"), "two\n");
  git("commit", "--quiet", "-am", "head");
  const head = git("rev-parse", "HEAD");
  git("update-ref", "refs/pull/1/head", head);
  // Back to base so the clone's default branch does not already hold head.
  git("reset", "--quiet", "--hard", base);
  return { url: `file://${dir}`, base, head };
}

/**
 * A fake `ocr` that records its argv and environment, checks that the rule
 * directory is gone, and behaves as the test asks through OCR_FAKE_MODE.
 */
function fakeOcr(mode: "ok" | "fail" | "sleep"): { binary: string; recorded: string } {
  const bin = mkdtempSync(join(tmpdir(), "ocr-bin-"));
  const recorded = join(bin, "recorded.json");
  const script = join(bin, "ocr");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `printf '%s\\0' "$@" > "${recorded}.args"`,
      `printf '%s\\n' "HOME=$HOME" "OCR_LLM_URL=$OCR_LLM_URL" "GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT" > "${recorded}.env"`,
      "if [ -e .opencodereview ]; then echo rule-dir-present >&2; exit 3; fi",
      mode === "sleep" ? "sleep 5" : "",
      mode === "fail" ? "echo boom >&2; exit 1" : "",
      `echo '${JSON.stringify(ENVELOPE)}'`,
    ].join("\n"),
    { mode: 0o755 },
  );
  return { binary: script, recorded };
}

function request(
  o: { url: string; base: string; head: string },
  over: Partial<ReviewRequest> = {},
) {
  return {
    repo: "o/r",
    prNumber: 1,
    cloneUrl: o.url,
    baseSha: o.base,
    headSha: o.head,
    title: "Add two",
    body: "why",
    ...over,
  };
}

describe("createReviewer", () => {
  let o: ReturnType<typeof origin>;
  beforeAll(() => {
    o = origin();
  });

  const reviewer = (binary: string, over: { timeoutMs?: number } = {}) =>
    createReviewer({
      exec: execFileNoShell(),
      tmpRoot: mkdtempSync(join(tmpdir(), "ocr-tmp-")),
      timeoutMs: over.timeoutMs ?? 60_000,
      maxTokensBudget: 1234,
      llmEnv: { OCR_LLM_URL: "http://llm.example" },
      ocrBinary: binary,
    });

  it("clones, verifies both commits, removes the rule directory and returns the envelope", async () => {
    const fake = fakeOcr("ok");
    const outcome = await reviewer(fake.binary)(request(o));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toEqual(ENVELOPE);
    expect(outcome.exitCode).toBe(0);
    const args = readFileSync(`${fake.recorded}.args`, "utf8").split("\0");
    expect(args.slice(0, 1)).toEqual(["review"]);
    expect(args).toContain("--from");
    expect(args[args.indexOf("--from") + 1]).toBe(o.base);
    expect(args[args.indexOf("--to") + 1]).toBe(o.head);
    expect(args[args.indexOf("--max-tokens-budget") + 1]).toBe("1234");
    expect(args[args.indexOf("--background") + 1]).toBe("Add two\n\nwhy");
    expect(args).toContain("agent");
    const env = readFileSync(`${fake.recorded}.env`, "utf8");
    // A writable HOME of its own, the model variables, and nothing of git's.
    expect(env).toMatch(/^HOME=.*\/home$/m);
    expect(env).toContain("OCR_LLM_URL=http://llm.example");
    expect(env).toContain("GIT_TERMINAL_PROMPT=\n");
  });

  it("refuses a head sha that is not what refs/pull/<n>/head resolves to", async () => {
    const fake = fakeOcr("ok");
    const outcome = await reviewer(fake.binary)(request(o, { headSha: "b".repeat(40) }));
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("head") });
  });

  it("refuses a base sha that is not a commit in the clone", async () => {
    const fake = fakeOcr("ok");
    const outcome = await reviewer(fake.binary)(request(o, { baseSha: "c".repeat(40) }));
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("base") });
  });

  it("reports a clone that fails without a credential prompt", async () => {
    const fake = fakeOcr("ok");
    const outcome = await reviewer(fake.binary)(
      request(o, { cloneUrl: `file://${join(tmpdir(), "does-not-exist-ocr")}` }),
    );
    expect(outcome).toMatchObject({ ok: false, error: "git clone failed" });
    if (outcome.ok) return;
    expect(outcome.stderrTail).toBeTruthy();
  });

  it("is a failure, not an envelope, when ocr prints no JSON", async () => {
    const fake = fakeOcr("fail");
    const outcome = await reviewer(fake.binary)(request(o));
    expect(outcome).toMatchObject({
      ok: false,
      error: "ocr printed no JSON envelope",
      exitCode: 1,
    });
    if (outcome.ok) return;
    expect(outcome.stderrTail).toContain("boom");
  });

  it("times out ocr against the request deadline", async () => {
    const fake = fakeOcr("sleep");
    const outcome = await reviewer(fake.binary, { timeoutMs: 1_500 })(request(o));
    expect(outcome).toMatchObject({ ok: false, error: "ocr timed out", exitCode: null });
  }, 15_000);
});
