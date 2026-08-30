import type { RunDigest, RunStatus, RunSummary } from "@/lib/api/types";
import { activity, boardMetrics, percentile } from "@/lib/board/metrics";
import { describe, expect, it } from "vitest";

/**
 * The rack's arithmetic. Every case here is about the same property: a run that
 * measured nothing must not be counted as a zero, and the number of runs that
 * did measure has to survive to the caller — a median over four runs and a
 * median over twenty-six are different claims about the same board.
 */

const T0 = "2026-08-28T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

function row(over: Partial<RunSummary> & { id: string; status: RunStatus }): RunSummary {
  return {
    repo: "o/r",
    pr_number: 1,
    head_sha: "abc1234",
    created_at: T0,
    updated_at: T0,
    pr_title: null,
    ...over,
  };
}

function digest(over: Partial<RunDigest> = {}): RunDigest {
  return {
    checks: {},
    findings: { critical: 0, warn: 0, info: 0 },
    durationMs: null,
    ...over,
  };
}

describe("percentile", () => {
  it("has no answer for an empty set, rather than zero", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("picks by nearest rank, so every value it returns was measured", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([9], 50)).toBe(9);
  });
});

describe("boardMetrics", () => {
  it("answers an empty board without inventing a number", () => {
    const metrics = boardMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.verdicts).toEqual([]);
    expect(metrics.activity).toEqual([]);
    expect(metrics.newestAt).toBeNull();
    expect(metrics.duration).toEqual({
      p50: null,
      p95: null,
      fastest: null,
      slowest: null,
      measured: 0,
    });
  });

  it("orders the verdict ribbon by RUN_STATUSES, not by arrival", () => {
    // Otherwise the ribbon resequences itself every time a run lands.
    const metrics = boardMetrics([
      row({ id: "a", status: "superseded" }),
      row({ id: "b", status: "clean" }),
      row({ id: "c", status: "running" }),
      row({ id: "d", status: "clean" }),
    ]);
    expect(metrics.verdicts.map((slice) => slice.status)).toEqual([
      "running",
      "clean",
      "superseded",
    ]);
    expect(metrics.verdicts.map((slice) => slice.count)).toEqual([1, 2, 1]);
    expect(metrics.verdicts[1]?.share).toBe(0.5);
  });

  it("counts a re-reviewed pull request once, and its runs separately", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "clean", head_sha: "aaa" }),
      row({ id: "b", status: "superseded", head_sha: "bbb" }),
      row({ id: "c", status: "clean", repo: "o/other", pr_number: 2 }),
    ]);
    expect(metrics.total).toBe(3);
    expect(metrics.pullRequests).toBe(2);
    expect(metrics.repos).toBe(2);
  });

  it("counts live runs, and the subset waiting on a person", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "running" }),
      row({ id: "b", status: "blocked_pending" }),
      row({ id: "c", status: "clean" }),
    ]);
    expect(metrics.live).toBe(2);
    expect(metrics.awaitingApproval).toBe(1);
  });

  it("excludes a run with no digest from every check tally", () => {
    // Not `absent`: that word means the fold saw the other checks and not this
    // one, which is a different fact from never having folded at all.
    const metrics = boardMetrics([
      row({
        id: "a",
        status: "clean",
        digest: digest({ checks: { tests: { status: "done", ms: 1_000, sandboxMs: null } } }),
      }),
      row({ id: "b", status: "superseded" }),
    ]);
    expect(metrics.unmeasured).toBe(1);
    const tests = metrics.sensors.find((row) => row.name === "tests");
    expect(tests).toMatchObject({ done: 1, error: 0, running: 0, absent: 0, observed: 1 });
    const probes = metrics.sensors.find((row) => row.name === "probes");
    expect(probes).toMatchObject({ absent: 1, observed: 1 });
  });

  it("reports a check's median beside how many runs timed it", () => {
    const metrics = boardMetrics([
      row({
        id: "a",
        status: "clean",
        digest: digest({ checks: { tests: { status: "done", ms: 10_000, sandboxMs: null } } }),
      }),
      row({
        id: "b",
        status: "clean",
        digest: digest({ checks: { tests: { status: "done", ms: 30_000, sandboxMs: null } } }),
      }),
      // Running: it has an outcome but no measurement, so it is in `running`
      // and not in the median.
      row({
        id: "c",
        status: "running",
        digest: digest({ checks: { tests: { status: "running", ms: null, sandboxMs: null } } }),
      }),
    ]);
    const tests = metrics.sensors.find((row) => row.name === "tests");
    expect(tests?.measured).toBe(2);
    // Nearest rank over two values, so the median is one of them and not their
    // mean: every number the rack shows was measured by some run.
    expect(tests?.medianMs).toBe(10_000);
    expect(tests?.running).toBe(1);
  });

  it("summarises durations over the runs that reported one", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "clean", digest: digest({ durationMs: 60_000 }) }),
      row({ id: "b", status: "clean", digest: digest({ durationMs: 20_000 }) }),
      // Still going. Counting this as 0 would drag every number down.
      row({ id: "c", status: "running", digest: digest({ durationMs: null }) }),
      row({ id: "d", status: "superseded" }),
    ]);
    expect(metrics.duration.measured).toBe(2);
    expect(metrics.duration.fastest).toBe(20_000);
    expect(metrics.duration.slowest).toBe(60_000);
  });

  it("takes the newest updated_at, whatever order the list arrived in", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "clean", updated_at: at(5) }),
      row({ id: "b", status: "clean", updated_at: at(90) }),
      row({ id: "c", status: "clean", updated_at: at(40) }),
    ]);
    expect(metrics.newestAt).toBe(at(90));
  });
});

describe("activity", () => {
  it("keeps the quiet hours, so a busy night and a quiet week differ", () => {
    const buckets = activity([
      row({ id: "a", status: "clean", created_at: at(0) }),
      row({ id: "b", status: "clean", created_at: at(10) }),
      row({ id: "c", status: "clean", created_at: at(180) }),
    ]);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 0, 0, 1]);
  });

  it("coarsens by steps, so a two-day window is not three fat bars", () => {
    // The failure this ladder replaced: a single hour-or-day choice sent a
    // 55-hour board straight to day buckets and drew three numbers large.
    const spanned = (hours: number, max = 60) =>
      activity(
        [
          row({ id: "a", status: "clean", created_at: at(0) }),
          row({ id: "b", status: "clean", created_at: at(hours * 60) }),
        ],
        max,
      );
    expect(spanned(6).length).toBe(7);
    // 55 hours: too many for hourly, so it steps to two-hour buckets rather
    // than all the way to days.
    expect(spanned(55).length).toBeGreaterThan(24);
    expect(spanned(55).length).toBeLessThanOrEqual(60);
    // A fortnight does step to days.
    expect(spanned(24 * 14).length).toBeLessThanOrEqual(60);
  });

  it("never returns more buckets than the strip asked for", () => {
    // Past the widest rung of the ladder the size is computed rather than
    // pinned to it: a fixed seven-day fallback drew 105 buckets for a two-year
    // record against a cap of 60, which is the bound this test exists for.
    for (const hours of [1, 5, 24, 55, 24 * 9, 24 * 60, 24 * 400, 24 * 730, 24 * 3650]) {
      const buckets = activity(
        [
          row({ id: "a", status: "clean", created_at: at(0) }),
          row({ id: "b", status: "clean", created_at: at(hours * 60) }),
        ],
        60,
      );
      expect(buckets.length).toBeLessThanOrEqual(60);
      expect(buckets.at(0)?.count).toBe(1);
      expect(buckets.at(-1)?.count).toBeGreaterThanOrEqual(1);
    }
  });

  it("has nothing to draw when no run carries a usable timestamp", () => {
    expect(activity([])).toEqual([]);
    expect(activity([row({ id: "a", status: "clean", created_at: "not a date" })])).toEqual([]);
  });
});

/**
 * What the record found, which is the question the verdict ribbon cannot
 * answer: it says how many runs went badly, not what was wrong with them.
 */
describe("boardMetrics findings", () => {
  const found = (over: Partial<RunDigest["findings"]>) =>
    digest({ findings: { critical: 0, warn: 0, info: 0, ...over } });

  it("sums by severity and counts the runs that produced any", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "blocked_posted", digest: found({ critical: 1, warn: 2 }) }),
      row({ id: "b", status: "clean", digest: found({ info: 3 }) }),
      row({ id: "c", status: "clean", digest: found({}) }),
    ]);
    expect(metrics.findings.bySeverity).toEqual({ critical: 1, warn: 2, info: 3 });
    expect(metrics.findings.total).toBe(6);
    expect(metrics.findings.producing).toBe(2);
    expect(metrics.findings.observed).toBe(3);
    expect(metrics.findings.worst).toBe("critical");
  });

  it("does not count a run that folded nothing as a run that found nothing", () => {
    // The same rule the sensor rows keep. A board of unfolded runs must not
    // report "0 of 3 found anything", which is a claim nobody measured.
    const metrics = boardMetrics([
      row({ id: "a", status: "superseded" }),
      row({ id: "b", status: "running" }),
    ]);
    expect(metrics.findings.observed).toBe(0);
    expect(metrics.findings.producing).toBe(0);
    expect(metrics.findings.total).toBe(0);
    expect(metrics.findings.worst).toBeNull();
  });

  it("reports the worst severity present and not the most common one", () => {
    const metrics = boardMetrics([
      row({ id: "a", status: "clean", digest: found({ info: 40 }) }),
      row({ id: "b", status: "blocked_posted", digest: found({ warn: 1 }) }),
    ]);
    expect(metrics.findings.worst).toBe("warn");
  });

  it("has an empty summary on an empty board rather than a missing one", () => {
    // The rack renders disarmed instead of returning null, so this shape has
    // to exist for a board with no runs at all.
    const metrics = boardMetrics([]);
    expect(metrics.findings).toEqual({
      bySeverity: { critical: 0, warn: 0, info: 0 },
      total: 0,
      producing: 0,
      observed: 0,
      worst: null,
    });
  });
});
