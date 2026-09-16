/**
 * How a claimed run picks its review (decision 135) and, for the diff review,
 * gets a session and a spec of its own (decision 137).
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader, PullRequestInfo } from "../../src/clients/github";
import type { Runner } from "../../src/review/runner.service";
import { type DiffReviewDeps, type StartRunDeps, startRun } from "../../src/review/start-run";
import type { RunRecord } from "../../src/review/types";
import { Store } from "../../src/store";

const pr = (over: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  repo: "o/r",
  prNumber: 7,
  title: "t",
  body: "b",
  baseSha: "base",
  headSha: "h",
  cloneUrl: "https://github.com/o/r.git",
  changedFiles: ["src/a.ts"],
  files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ +1 @@" }],
  authorLogin: "octocat",
  authorId: 1,
  authorIsBot: false,
  ...over,
});

function harness(over: {
  pr?: PullRequestInfo;
  declared?: "sandbox" | "diff" | null;
  declaredError?: Error;
  diff?: Partial<DiffReviewDeps> | null;
  /** Wire the detonation cache with these entries (decision 145). */
  cache?: Record<string, unknown>;
  /** The board's layer for the repository (decision 155). */
  board?: { mode?: "sandbox" | "diff" | null; instructions?: string | null };
  /** `.cujo/REVIEW.md` at base, when the repository carries one. */
  reviewFile?: string;
  /** The run's repository is private (decision 158). */
  isPublic?: boolean;
  /** Wire the staging door, answering with this, or throwing it. */
  stage?: { fail?: Error };
  /** Wire the shadow review with this answer (decision 149). */
  ocr?: () => Promise<
    | { ok: true; result: unknown; exitCode: number | null; durationMs: number }
    | { ok: false; error: string }
  >;
}) {
  const store = new Store(":memory:");
  const run = store.runs.createRun({
    repo: "o/r",
    prNumber: 7,
    headSha: "h",
    sessionId: "s-pr",
    isPublic: over.isPublic ?? true,
    model: "p/m",
    rubricSha256: "sandbox-rubric",
  }).run;
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
  const runner = {
    start: vi.fn(async () => {}),
    fail: vi.fn((id: string, _m: string) => store.runs.updateRun(id, { status: "error" })),
    supersede: vi.fn(async () => {}),
  } as unknown as Runner;
  const github = {
    alreadyReviewed: vi.fn(async () => false),
    archive: vi.fn(async (_repo: string, sha: string) => sha),
    pullRequest: vi.fn(async () => over.pr ?? pr()),
    declaredMode: vi.fn(async () => {
      if (over.declaredError) throw over.declaredError;
      return over.declared ?? null;
    }),
    readFile: vi.fn(async (_r: string, path: string) =>
      path === "CONTRIBUTING.md"
        ? "## Standards\n"
        : path === ".cujo/REVIEW.md"
          ? (over.reviewFile ?? null)
          : null,
    ),
  } as unknown as GitHubReader;
  const createSession = vi.fn(async () => "s-diff");
  const diff: DiffReviewDeps = {
    deployDefault: "sandbox",
    createSession,
    provenance: { model: "p/flash", rubricSha256: "diff-rubric", budgetTokens: 400_000 },
    caps: { diffBytes: 60_000, standardsFileBytes: 16_000, standardsTotalBytes: 48_000 },
    ...over.diff,
  };
  const asked: string[] = [];
  const kept: unknown[] = [];
  const detonations = {
    putForRun: (_runId: string, entries: readonly unknown[]) => {
      kept.push(...entries);
    },
    get: (source: string, specifier: string) => {
      asked.push(`${source} ${specifier}`);
      const report = over.cache?.[`${source} ${specifier}`];
      return report
        ? {
            source: source as "pypi",
            specifier,
            report,
            runId: "run-earlier",
            runIsPublic: true,
            createdAt: "2026-09-10T00:00:00.000Z",
          }
        : null;
    },
  };
  const ocrCalls: unknown[] = [];
  const ocr = over.ocr
    ? {
        client: {
          review: async (input: unknown) => {
            ocrCalls.push(input);
            return over.ocr?.() as never;
          },
        },
        store: store.ocr,
      }
    : undefined;
  const staged: { ticket: string; tree: string; body: unknown }[] = [];
  const stage = over.stage
    ? {
        stager: {
          put: async (ticket: string, tree: "base" | "head", body: ReadableStream) => {
            if (over.stage?.fail) throw over.stage.fail;
            staged.push({ ticket, tree, body });
            return 1;
          },
        },
      }
    : undefined;
  const deps: StartRunDeps = {
    github,
    store: store.runs,
    runner,
    log,
    reviewRunId: (r: RunRecord) => r.id,
    ...(over.diff === null ? {} : { diff }),
    ...(stage ? { stage } : {}),
    ...(over.cache ? { detonations } : {}),
    ...(ocr ? { ocr } : {}),
    ...(over.board
      ? {
          repositorySettings: {
            get: () => ({
              mode: over.board?.mode ?? null,
              instructions: over.board?.instructions ?? null,
              updatedAt: "t",
            }),
          },
        }
      : {}),
  };
  return { store, run, runner, github, createSession, deps, lines, asked, kept, ocrCalls, staged };
}

/** The brief `Runner.start` was handed, parsed. */
function briefOf(runner: Runner): Record<string, unknown> {
  const start = runner.start as unknown as { mock: { calls: unknown[][] } };
  const message = String(start.mock.calls[0]?.[1]);
  const fenced = message.slice(message.indexOf("```json\n") + 8, message.lastIndexOf("```"));
  return JSON.parse(fenced) as Record<string, unknown>;
}

describe("startRun picks the review", () => {
  it("starts a sandbox run on the pull request's session when nothing says otherwise", async () => {
    const h = harness({});
    await startRun(h.deps, h.run);
    const started = (h.runner.start as ReturnType<typeof vi.fn>).mock.calls[0] as [
      RunRecord,
      string,
    ];
    expect(started[0].sessionId).toBe("s-pr");
    expect(started[0].mode).toBe("sandbox");
    expect(started[1]).toContain("Review this pull request. Input:");
    expect(started[1]).toContain("clone_url");
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.store.runs.getRun(h.run.id)).toMatchObject({
      mode: "sandbox",
      model: "p/m",
      rubricSha256: "sandbox-rubric",
      budgetTokens: null,
    });
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({
      mode: "sandbox",
      reason: "deploy_default",
    });
  });

  it("starts a diff run on a fresh session with the diff spec's provenance when the repo says so", async () => {
    const h = harness({ declared: "diff" });
    await startRun(h.deps, h.run);
    expect(h.github.declaredMode).toHaveBeenCalledWith("o/r", "base");
    expect(h.createSession).toHaveBeenCalledTimes(1);
    const started = (h.runner.start as ReturnType<typeof vi.fn>).mock.calls[0] as [
      RunRecord,
      string,
    ];
    // The runner is handed the corrected record: it reads the session off it.
    expect(started[0].sessionId).toBe("s-diff");
    expect(started[0].mode).toBe("diff");
    expect(started[1]).toContain("Review this pull request by reading it. Input:");
    expect(started[1]).toContain('"standards"');
    expect(started[1]).toContain("## Standards");
    expect(started[1]).not.toContain("clone_url");
    expect(h.store.runs.getRun(h.run.id)).toMatchObject({
      sessionId: "s-diff",
      mode: "diff",
      model: "p/flash",
      rubricSha256: "diff-rubric",
      budgetTokens: 400_000,
    });
    // The pull request's own session row is untouched for the sandbox review.
    expect(h.store.runs.getSession("o/r", 7)).toBeNull();
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({
      mode: "diff",
      reason: "declared",
    });
  });

  it("takes the deploy default when the repo declares none", async () => {
    const h = harness({ diff: { deployDefault: "diff" } });
    await startRun(h.deps, h.run);
    expect(h.store.runs.getRun(h.run.id)?.mode).toBe("diff");
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({
      reason: "deploy_default",
    });
  });

  it("floors a manifest change to the sandbox whatever the repo declared", async () => {
    const h = harness({
      declared: "diff",
      pr: pr({ changedFiles: ["package.json", "src/a.ts"] }),
    });
    await startRun(h.deps, h.run);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.store.runs.getRun(h.run.id)).toMatchObject({ mode: "sandbox", sessionId: "s-pr" });
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({
      mode: "sandbox",
      reason: "manifest_floor",
    });
  });

  it("hands the sandbox brief the cached detonations for the pins this head adds", async () => {
    const report = { dependency: "humanize==4.9.0", source: "pypi", install_ok: true };
    const h = harness({
      cache: { "pypi humanize==4.9.0": report },
      pr: pr({
        changedFiles: ["requirements.txt"],
        files: [
          {
            path: "requirements.txt",
            status: "modified",
            additions: 2,
            deletions: 0,
            patch: "@@ -1,1 +1,3 @@\n flask==3.0.0\n+humanize==4.9.0\n+rich>=13",
          },
        ],
      }),
    });
    await startRun(h.deps, h.run);
    // Only the exact pin is asked for; the range never reaches the store.
    expect(h.asked).toEqual(["pypi humanize==4.9.0"]);
    // The brief carries the key and the date; the report stays on the
    // trusted side, kept on the run for the fold (decision 148).
    expect(briefOf(h.runner).detonation_cached).toEqual([
      {
        dependency: "humanize==4.9.0",
        source: "pypi",
        run_id: "run-earlier",
        cached_at: "2026-09-10T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(briefOf(h.runner))).not.toContain("install_ok");
    expect(h.kept).toEqual([
      {
        source: "pypi",
        specifier: "humanize==4.9.0",
        report,
        cachedFromRun: "run-earlier",
        cachedAt: "2026-09-10T00:00:00.000Z",
      },
    ]);
    expect(h.lines.find((l) => l.event === "run.detonation.cached")).toMatchObject({ count: 1 });
  });

  it("asks the cache nothing when no manifest changed", async () => {
    const h = harness({ cache: { "pypi humanize==4.9.0": { install_ok: true } } });
    await startRun(h.deps, h.run);
    expect(h.asked).toEqual([]);
    expect("detonation_cached" in briefOf(h.runner)).toBe(false);
  });

  it("floors a Bot author to the sandbox", async () => {
    const h = harness({ declared: "diff", pr: pr({ authorIsBot: true }) });
    await startRun(h.deps, h.run);
    expect(h.store.runs.getRun(h.run.id)?.mode).toBe("sandbox");
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({
      reason: "bot_floor",
    });
  });

  it("ends the run in error when the policy read fails, rather than guessing", async () => {
    const h = harness({ declaredError: new Error("GitHub /contents returned 500") });
    await startRun(h.deps, h.run);
    expect(h.runner.start).not.toHaveBeenCalled();
    expect(h.runner.fail).toHaveBeenCalledWith(
      h.run.id,
      expect.stringContaining("could not prepare run"),
    );
  });

  it("starts every run as a sandbox run when the diff review is not composed", async () => {
    const h = harness({ declared: "diff", diff: null });
    await startRun(h.deps, h.run);
    expect(h.github.declaredMode).not.toHaveBeenCalled();
    expect(h.store.runs.getRun(h.run.id)?.mode).toBe("sandbox");
  });
});

describe("startRun asks the shadow review (decision 149)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("asks once with the pull request's shas and text, in both modes, without waiting", async () => {
    for (const declared of ["sandbox", "diff"] as const) {
      const h = harness({
        declared,
        ocr: async () => ({ ok: true, result: { comments: [] }, exitCode: 0, durationMs: 9 }),
      });
      await startRun(h.deps, h.run);
      expect(h.runner.start).toHaveBeenCalledTimes(1);
      await settle();
      expect(h.ocrCalls).toEqual([
        {
          repo: "o/r",
          prNumber: 7,
          cloneUrl: "https://github.com/o/r.git",
          baseSha: "base",
          headSha: "h",
          title: "t",
          body: "b",
        },
      ]);
      expect(h.store.ocr.get(h.run.id)).toMatchObject({
        status: "ok",
        resultJson: JSON.stringify({ comments: [] }),
        durationMs: 9,
      });
      expect(h.lines.find((l) => l.event === "ocr.review.finished")).toMatchObject({
        run_id: h.run.id,
        duration_ms: 9,
      });
    }
  });

  it("asks nobody when no sidecar is composed", async () => {
    const h = harness({});
    await startRun(h.deps, h.run);
    await settle();
    expect(h.ocrCalls).toEqual([]);
    expect(h.store.ocr.get(h.run.id)).toBeNull();
  });

  it("records a refusal as an error row and the run goes on", async () => {
    const h = harness({ ocr: async () => ({ ok: false, error: "busy" }) });
    await startRun(h.deps, h.run);
    await settle();
    expect(h.runner.start).toHaveBeenCalledTimes(1);
    expect(h.store.ocr.get(h.run.id)).toMatchObject({ status: "error", error: "busy" });
    expect(h.lines.find((l) => l.event === "ocr.review.failed")).toMatchObject({
      error_message: "busy",
    });
  });

  it("records a client that throws as an error row and the run goes on", async () => {
    const h = harness({
      ocr: async () => {
        throw new Error("socket hang up");
      },
    });
    await startRun(h.deps, h.run);
    await settle();
    expect(h.runner.start).toHaveBeenCalledTimes(1);
    expect(h.store.ocr.get(h.run.id)).toMatchObject({ status: "error", error: "socket hang up" });
  });
});

describe("startRun reads the board and the repository's instructions (decision 155)", () => {
  it("takes the board's mode under the file's, and reports the reason", async () => {
    const h = harness({ board: { mode: "diff" } });
    await startRun(h.deps, h.run);
    expect(h.store.runs.getRun(h.run.id)?.mode).toBe("diff");
    expect(h.lines.find((l) => l.event === "run.mode.resolved")).toMatchObject({ reason: "board" });
    const file = harness({ board: { mode: "diff" }, declared: "sandbox" });
    await startRun(file.deps, file.run);
    expect(file.store.runs.getRun(file.run.id)?.mode).toBe("sandbox");
  });

  it("hands the instructions to the sandbox brief and to the diff package, file first", async () => {
    const h = harness({ board: { instructions: "From the board." } });
    await startRun(h.deps, h.run);
    expect(briefOf(h.runner).instructions).toEqual({
      source: "board",
      text: "From the board.",
      truncated: false,
    });
    expect(h.lines.find((l) => l.event === "run.instructions.read")).toMatchObject({
      reason: "board",
    });
    const d = harness({
      declared: "diff",
      board: { instructions: "From the board." },
      reviewFile: "From the file.\n",
    });
    await startRun(d.deps, d.run);
    expect(briefOf(d.runner).instructions).toEqual({
      source: "file",
      text: "From the file.\n",
      truncated: false,
    });
    const none = harness({});
    await startRun(none.deps, none.run);
    expect("instructions" in briefOf(none.runner)).toBe(false);
  });
});

describe("startRun stages a private repository's trees (decision 158)", () => {
  it("briefs a ticket and no clone URL, with both trees staged under it", async () => {
    const h = harness({ isPublic: false, stage: {} });
    await startRun(h.deps, h.run);
    const brief = briefOf(h.runner);
    expect(brief.staged).toMatch(/^[0-9a-f]{32}$/);
    expect(brief).not.toHaveProperty("clone_url");
    expect(h.github.archive).toHaveBeenCalledTimes(2);
    expect(h.staged.map((s) => [s.tree, s.body])).toEqual([
      ["base", "base"],
      ["head", "h"],
    ]);
    expect(new Set(h.staged.map((s) => s.ticket)).size).toBe(1);
    expect(h.staged[0]?.ticket).toBe(brief.staged);
    expect(h.lines.find((l) => l.event === "run.staged")).toMatchObject({ bytes: 2 });
  });

  it("briefs a public repository's clone URL and stages nothing", async () => {
    const h = harness({ isPublic: true, stage: {} });
    await startRun(h.deps, h.run);
    expect(briefOf(h.runner)).toHaveProperty("clone_url");
    expect(h.staged).toEqual([]);
    expect(h.github.archive).not.toHaveBeenCalled();
  });

  it("fails the run before any turn when staging fails", async () => {
    const h = harness({
      isPublic: false,
      stage: { fail: new Error("staging the base tree failed: full") },
    });
    await startRun(h.deps, h.run);
    expect(h.runner.start).not.toHaveBeenCalled();
    expect(h.runner.fail).toHaveBeenCalledWith(
      h.run.id,
      expect.stringContaining("staging the base tree failed"),
    );
    expect(h.lines.find((l) => l.event === "run.prepare.failed")).toBeDefined();
  });

  it("fails a private repository's run when no staging door is composed", async () => {
    const h = harness({ isPublic: false });
    await startRun(h.deps, h.run);
    expect(h.runner.start).not.toHaveBeenCalled();
    expect(h.runner.fail).toHaveBeenCalledWith(
      h.run.id,
      expect.stringContaining("no staging door is configured"),
    );
  });

  it("skips the shadow review for a private repository with a line", async () => {
    const h = harness({
      isPublic: false,
      stage: {},
      ocr: async () => ({ ok: true, result: {}, exitCode: 0, durationMs: 1 }),
    });
    await startRun(h.deps, h.run);
    expect(h.ocrCalls).toEqual([]);
    expect(h.lines.find((l) => l.event === "ocr.skipped")).toMatchObject({ reason: "private" });
    expect(h.store.ocr.get(h.run.id)).toBeNull();
  });
});

describe("the sandbox budget and the turn's bound (decision 165)", () => {
  it("stamps the sandbox budget on the row and tells the parent its ceiling", async () => {
    const h = harness({});
    await startRun(
      { ...h.deps, sandboxBudgetTokens: () => 3_000_000, turnTimeoutMs: () => 900_000 },
      h.run,
    );
    expect(h.store.runs.getRun(h.run.id)?.budgetTokens).toBe(3_000_000);
    expect(briefOf(h.runner).turn_budget_ms).toBe(900_000);
  });

  it("stamps nothing and says nothing without them, as before", async () => {
    const h = harness({});
    await startRun(h.deps, h.run);
    expect(h.store.runs.getRun(h.run.id)?.budgetTokens).toBeNull();
    expect(briefOf(h.runner)).not.toHaveProperty("turn_budget_ms");
  });
});
