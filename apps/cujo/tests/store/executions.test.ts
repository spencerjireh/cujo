import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

describe("the execution store (decision 161)", () => {
  it("keeps each executed check's envelope and hands them back in order", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.executions.putCheck({
      runId: run.id,
      check: "tests",
      report: { check: "tests", runs: [], base_pass_head_fail: ["a"] },
      startedAt: "2026-09-16T10:00:00.000Z",
      endedAt: "2026-09-16T10:01:00.000Z",
    });
    expect(store.executions.checksForRun(run.id)).toEqual([
      {
        runId: run.id,
        check: "tests",
        report: { check: "tests", runs: [], base_pass_head_fail: ["a"] },
        startedAt: "2026-09-16T10:00:00.000Z",
        endedAt: "2026-09-16T10:01:00.000Z",
      },
    ]);
    expect(store.executions.checksForRun("nope")).toEqual([]);
  });

  it("keeps the box until it is marked destroyed, and lists what is still owed", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.executions.putSandbox({
      runId: run.id,
      sandboxId: "sbx-1",
      provisionedMs: 1234,
      env: { HTTP_PROXY: "http://127.0.0.1:8899" },
    });
    expect(store.executions.sandboxForRun(run.id)).toEqual({
      runId: run.id,
      sandboxId: "sbx-1",
      provisionedMs: 1234,
      env: { HTTP_PROXY: "http://127.0.0.1:8899" },
      destroyedAt: null,
    });
    expect(store.executions.listUndestroyed().map((b) => b.runId)).toEqual([run.id]);
    store.executions.markDestroyed(run.id, "2026-09-16T10:05:00.000Z");
    expect(store.executions.sandboxForRun(run.id)?.destroyedAt).toBe("2026-09-16T10:05:00.000Z");
    expect(store.executions.listUndestroyed()).toEqual([]);
    // Marked once: a second mark keeps the first time.
    store.executions.markDestroyed(run.id, "2026-09-16T11:00:00.000Z");
    expect(store.executions.sandboxForRun(run.id)?.destroyedAt).toBe("2026-09-16T10:05:00.000Z");
  });
});
