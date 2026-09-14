/**
 * One review: a fresh clone, the two commits verified, `ocr` over them, and
 * the directory gone. Nothing persists between requests, which is what lets a
 * read-only container with a tmpfs run this at all.
 *
 * The clone fetches the head as `refs/pull/<n>/head`, the only way to reach a
 * fork's commit, and refuses to continue unless that ref resolves to exactly
 * the `headSha` the caller named and `baseSha` is a commit in the clone — the
 * same two checks `sniff.py prepare` makes, for the same reason: the caller
 * said what it wants reviewed, and this box must not review something else.
 *
 * `ocr` reads `.opencodereview/rule.json` from the repository it reviews, and
 * `--rule` adds a layer above it rather than replacing it (verified in the
 * v1.12.0 source, `internal/config/rules/system_rules.go`). That is text out
 * of a pull request steering a trusted model, so the directory is deleted from
 * the checkout before `ocr` runs. The diff is taken from the two refs and does
 * not notice.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Exec } from "./exec";
import { BACKGROUND_CAP, type ReviewRequest } from "./request";

export type ReviewOutcome =
  | {
      ok: true;
      /** `ocr`'s JSON envelope, verbatim. */
      result: unknown;
      exitCode: number | null;
      durationMs: number;
    }
  | {
      ok: false;
      error: string;
      exitCode?: number | null;
      stderrTail?: string;
      durationMs: number;
    };

export interface ReviewerOptions {
  exec: Exec;
  /** Where the per-request directories are made; a tmpfs in the container. */
  tmpRoot: string;
  /** Bound on the whole request, clone included. */
  timeoutMs: number;
  /** `--max-tokens-budget`; 0 means unlimited, which is `ocr`'s own default. */
  maxTokensBudget: number;
  /** The `OCR_LLM_*` variables and nothing else this process holds. */
  llmEnv: Readonly<Record<string, string>>;
  gitBinary?: string;
  ocrBinary?: string;
}

const GIT_STEP_TIMEOUT_MS = 5 * 60 * 1000;
const STDERR_TAIL = 2_000;
/** The ref the head is fetched to; `refs/cujo/` so no branch name can collide. */
const HEAD_REF = "refs/cujo/pr";

export type Reviewer = (input: ReviewRequest) => Promise<ReviewOutcome>;

export function createReviewer(options: ReviewerOptions): Reviewer {
  const git = options.gitBinary ?? "git";
  const ocr = options.ocrBinary ?? "ocr";
  return async (input) => {
    const started = Date.now();
    const deadline = started + options.timeoutMs;
    const remaining = () => Math.max(1, deadline - Date.now());
    const dir = await mkdtemp(join(options.tmpRoot, "ocr-"));
    const repo = join(dir, "repo");
    const home = join(dir, "home");
    const fail = (
      error: string,
      extra: { exitCode?: number | null; stderrTail?: string } = {},
    ): ReviewOutcome => ({ ok: false, error, ...extra, durationMs: Date.now() - started });
    try {
      await mkdir(home, { mode: 0o700 });
      // No credential helper, no prompt: a repository this cannot clone
      // anonymously is one it does not review.
      const gitEnv = { PATH: process.env.PATH ?? "", GIT_TERMINAL_PROMPT: "0", HOME: home };
      const gitStep = async (args: readonly string[], cwd?: string) =>
        options.exec(git, args, {
          cwd,
          env: gitEnv,
          timeoutMs: Math.min(GIT_STEP_TIMEOUT_MS, remaining()),
        });

      const clone = await gitStep(["clone", "--quiet", "--no-checkout", input.cloneUrl, repo]);
      if (clone.exitCode !== 0) return fail("git clone failed", tail(clone));
      const fetch = await gitStep(
        ["fetch", "--quiet", "origin", `+refs/pull/${input.prNumber}/head:${HEAD_REF}`],
        repo,
      );
      if (fetch.exitCode !== 0)
        return fail("git fetch of the pull request head failed", tail(fetch));
      const head = await gitStep(["rev-parse", "--verify", `${HEAD_REF}^{commit}`], repo);
      if (head.exitCode !== 0 || head.stdout.trim() !== input.headSha) {
        return fail("the pull request head is not the sha the caller named");
      }
      const base = await gitStep(["cat-file", "-e", `${input.baseSha}^{commit}`], repo);
      if (base.exitCode !== 0) return fail("the base sha is not a commit in the clone");
      const checkout = await gitStep(["checkout", "--quiet", "--detach", input.headSha], repo);
      if (checkout.exitCode !== 0) return fail("git checkout of the head failed", tail(checkout));
      await rm(join(repo, ".opencodereview"), { recursive: true, force: true });

      const minutes = Math.max(1, Math.ceil(remaining() / 60_000));
      const args = [
        "review",
        "--repo",
        repo,
        "--from",
        input.baseSha,
        "--to",
        input.headSha,
        "--format",
        "json",
        "--audience",
        "agent",
        "--timeout",
        String(minutes),
        "--max-tokens-budget",
        String(options.maxTokensBudget),
      ];
      const background = `${input.title}\n\n${input.body}`.trim().slice(0, BACKGROUND_CAP);
      if (background) args.push("--background", background);
      const run = await options.exec(ocr, args, {
        cwd: repo,
        env: { PATH: process.env.PATH ?? "", HOME: home, ...options.llmEnv },
        timeoutMs: remaining(),
      });
      if (run.timedOut) return fail("ocr timed out", tail(run));
      let result: unknown;
      try {
        result = JSON.parse(run.stdout);
      } catch {
        return fail("ocr printed no JSON envelope", tail(run));
      }
      return { ok: true, result, exitCode: run.exitCode, durationMs: Date.now() - started };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "review failed");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

function tail(result: { stderr: string; exitCode: number | null }) {
  return { exitCode: result.exitCode, stderrTail: result.stderr.slice(-STDERR_TAIL) };
}
