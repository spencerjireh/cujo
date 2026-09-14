import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

describe("the shadow review store (decision 149)", () => {
  it("records a start, then the verbatim result", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.ocr.markStarted(run.id, "ocr", "2026-09-14T10:00:00.000Z");
    expect(store.ocr.get(run.id)).toMatchObject({
      runId: run.id,
      provider: "ocr",
      status: "running",
      resultJson: null,
      finishedAt: null,
    });
    const json = JSON.stringify({ status: "success", comments: [{ path: "a", severity: "low" }] });
    store.ocr.finish(
      run.id,
      { status: "ok", resultJson: json, error: null, exitCode: 0, durationMs: 4200 },
      "2026-09-14T10:01:00.000Z",
    );
    expect(store.ocr.get(run.id)).toEqual({
      runId: run.id,
      provider: "ocr",
      status: "ok",
      resultJson: json,
      error: null,
      exitCode: 0,
      startedAt: "2026-09-14T10:00:00.000Z",
      finishedAt: "2026-09-14T10:01:00.000Z",
      durationMs: 4200,
    });
  });

  it("keeps an error with no result, and a second start replaces the row", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.ocr.markStarted(run.id, "ocr", "t0");
    store.ocr.finish(
      run.id,
      { status: "error", resultJson: null, error: "busy", exitCode: null, durationMs: 3 },
      "t1",
    );
    expect(store.ocr.get(run.id)).toMatchObject({ status: "error", error: "busy", exitCode: null });
    store.ocr.markStarted(run.id, "ocr", "t2");
    expect(store.ocr.get(run.id)).toMatchObject({
      status: "running",
      error: null,
      startedAt: "t2",
    });
    expect(store.ocr.get("nope")).toBeNull();
  });
});
