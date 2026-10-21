import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { backfillPullRequestStates } from "../../src/review/pr-state-backfill";
import { Store } from "../../src/store";

const at = new Date("2026-10-20T12:00:00.000Z");

describe("the pull request state backfill (decision 179)", () => {
  it("asks GitHub about each unknown pull request with runs, one at a time", async () => {
    const store = new Store(":memory:");
    const run = { headSha: "h", sessionId: "s", isPublic: true, repo: "o/r" };
    store.runs.createRun({ ...run, prNumber: 1 });
    store.runs.createRun({ ...run, prNumber: 2 });
    store.runs.createRun({ ...run, prNumber: 3 });
    store.pullRequests.set({ repo: "o/r", prNumber: 3 }, "open", null, at);
    const pullRequestState = vi.fn(async (_repo: string, n: number) =>
      n === 1 ? { state: "merged" as const, closedAt: "2026-10-01T00:00:00Z" } : null,
    );
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) });

    const result = await backfillPullRequestStates({
      log,
      github: { pullRequestState },
      pullRequests: store.pullRequests,
      now: () => at,
    });

    expect(result).toEqual({ checked: 2, recorded: 1, unknown: 1 });
    expect(pullRequestState.mock.calls.map(([, n]) => n)).toEqual([1, 2]);
    expect(store.pullRequests.get({ repo: "o/r", prNumber: 1 })).toBe("merged");
    // GitHub did not answer: still unknown, so asked again on the next boot.
    expect(store.pullRequests.unknownWithRuns()).toEqual([{ repo: "o/r", prNumber: 2 }]);
    expect(lines.filter((l) => l.event === "pr_state.swept")).toMatchObject([
      { active: 2, count: 1, attempts: 1 },
    ]);
  });

  it("is silent when there is nothing to ask", async () => {
    const lines: string[] = [];
    const store = new Store(":memory:");
    const pullRequestState = vi.fn();
    await backfillPullRequestStates({
      log: createLogger({ service: "cujo", sink: (l) => lines.push(l) }),
      github: { pullRequestState },
      pullRequests: store.pullRequests,
    });
    expect(pullRequestState).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
