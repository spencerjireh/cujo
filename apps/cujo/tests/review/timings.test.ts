/**
 * The model-versus-sandbox split.
 *
 * The rule under every case here is the one `durationOf` established and this
 * module inherited: omit rather than guess. A check with half its inputs has no
 * honest number, and a zero would read as an instantaneous check.
 */

import { describe, expect, it } from "vitest";
import { checkTimings } from "../../src/review/timings";
import type { CheckState } from "../../src/review/types";

const check = (over: Partial<CheckState> = {}): CheckState => ({
  threadId: "th-tests",
  title: "tests",
  isCheck: true,
  status: "done",
  report: null,
  error: null,
  startedAt: "2026-08-29T10:00:00.000Z",
  endedAt: "2026-08-29T10:01:40.000Z",
  ...over,
});

const runs = (...seconds: number[]) => ({
  check: "tests",
  runs: seconds.map((duration_s) => ({ duration_s })),
});

describe("checkTimings", () => {
  it("splits the thread's wall time into sandbox and model", () => {
    expect(checkTimings(check({ report: runs(30, 41.5) }))).toEqual({
      wallMs: 100_000,
      sandboxMs: 71_500,
      modelMs: 28_500,
    });
  });

  it("gives no wall time, and so no split, without both timestamps", () => {
    expect(checkTimings(check({ startedAt: null, report: runs(30) }))).toEqual({
      sandboxMs: 30_000,
    });
    expect(checkTimings(check({ endedAt: null, report: runs(30) }))).toEqual({ sandboxMs: 30_000 });
  });

  it("gives no sandbox time for a report that measured none", () => {
    // Distinct from measuring zero. A check with no report, or one whose runs[]
    // never arrived, has not established that nothing ran.
    expect(checkTimings(check({ report: null }))).toEqual({ wallMs: 100_000 });
    expect(checkTimings(check({ report: { check: "tests" } }))).toEqual({ wallMs: 100_000 });
    expect(checkTimings(check({ report: "prose" }))).toEqual({ wallMs: 100_000 });
  });

  it("counts an empty runs[] as zero sandbox time, because it measured", () => {
    expect(checkTimings(check({ report: runs() }))).toEqual({
      wallMs: 100_000,
      sandboxMs: 0,
      modelMs: 100_000,
    });
  });

  it("skips a duration that is not a number and keeps the rest", () => {
    const report = { runs: [{ duration_s: 10 }, { duration_s: "nope" }, {}, { duration_s: -5 }] };
    expect(checkTimings(check({ report })).sandboxMs).toBe(10_000);
  });

  it("omits the model time when the sandbox accounts for more than the thread", () => {
    // Not a rounding guard. `duration_s` is `time.monotonic()` inside the
    // sandbox and the wall time is the gap between two harness timestamps, so
    // on a short check the two clocks can disagree in this direction. A
    // negative "thinking time" would be worse than none.
    const t = checkTimings(check({ report: runs(200) }));
    expect(t).toEqual({ wallMs: 100_000, sandboxMs: 200_000 });
    expect(t.modelMs).toBeUndefined();
  });

  it("is exact when the sandbox accounts for all of it", () => {
    expect(checkTimings(check({ report: runs(100) })).modelMs).toBe(0);
  });
});
