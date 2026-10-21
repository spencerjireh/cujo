import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const t0 = new Date("2026-10-20T12:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const pr = { repo: "o/r", prNumber: 7 };

describe("pull request states (decision 179)", () => {
  it("knows nothing until told, then the latest state", () => {
    const store = new Store(":memory:");
    expect(store.pullRequests.get(pr)).toBeNull();
    expect(store.pullRequests.set(pr, "merged", t0.toISOString(), t0)).toBe(true);
    expect(store.pullRequests.get(pr)).toBe("merged");
    expect(store.pullRequests.set(pr, "open", null, later(1000))).toBe(true);
    expect(store.pullRequests.get(pr)).toBe("open");
  });

  it("ignores a delivery older than what it holds", () => {
    const store = new Store(":memory:");
    store.pullRequests.set(pr, "open", null, later(1000));
    // The `closed` that came before the reopen, arriving late.
    expect(store.pullRequests.set(pr, "closed", t0.toISOString(), t0)).toBe(false);
    expect(store.pullRequests.get(pr)).toBe("open");
  });

  it("matches a repository whatever its case", () => {
    const store = new Store(":memory:");
    store.pullRequests.set({ repo: "Owner/Repo", prNumber: 3 }, "closed", null, t0);
    expect(store.pullRequests.get({ repo: "owner/repo", prNumber: 3 })).toBe("closed");
    const states = store.pullRequests.states([
      { repo: "OWNER/repo", prNumber: 3 },
      { repo: "owner/repo", prNumber: 4 },
    ]);
    expect([...states]).toEqual([["owner/repo#3", "closed"]]);
  });

  it("lists the pull requests with runs and no known state", () => {
    const store = new Store(":memory:");
    const run = { headSha: "h", sessionId: "s", isPublic: true };
    store.runs.createRun({ ...run, repo: "o/r", prNumber: 1 });
    store.runs.createRun({ ...run, repo: "o/r", prNumber: 1, headSha: "h2" });
    store.runs.createRun({ ...run, repo: "o/r", prNumber: 2 });
    store.pullRequests.set({ repo: "O/R", prNumber: 2 }, "merged", null, t0);
    expect(store.pullRequests.unknownWithRuns()).toEqual([{ repo: "o/r", prNumber: 1 }]);
  });
});
