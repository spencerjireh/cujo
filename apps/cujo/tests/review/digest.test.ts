/**
 * The digest (decision 65). Every case here is a projection the board will
 * actually meet: a run mid-flight, a run whose sensor never armed, a run
 * folded before the timestamps existed, and a run that never ran at all.
 *
 * The property under all of them: an unknown is null and never a zero. A board
 * that draws "0s" for "we do not know" is claiming a measurement nobody made.
 */

import { describe, expect, it } from "vitest";
import { deriveDigest } from "../../src/review/digest";
import { emptyProjection } from "../../src/review/fold";
import type { CheckState, Finding, Projection } from "../../src/review/types";

function check(over: Partial<CheckState> & { title: string }): CheckState {
  return {
    threadId: `thread-${over.title}`,
    isCheck: true,
    status: "done",
    report: null,
    error: null,
    startedAt: null,
    endedAt: null,
    ...over,
  };
}

function finding(severity: Finding["severity"], checkName = "tests"): Finding {
  return { source: "agent", check: checkName, severity, title: "t", evidence: "e" };
}

function projection(over: Partial<Projection>): Projection {
  return { ...emptyProjection(), ...over };
}

const T0 = "2026-08-29T10:00:00.000Z";
const T30 = "2026-08-29T10:00:30.000Z";
const T90 = "2026-08-29T10:01:30.000Z";

describe("deriveDigest", () => {
  it("measures each named check, and the envelope around all of them", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "tests", startedAt: T0, endedAt: T30 }),
          check({ title: "detonation", startedAt: T30, endedAt: T90 }),
        ],
      }),
    );
    expect(digest.checks).toEqual({
      tests: { status: "done", ms: 30_000, sandboxMs: null },
      detonation: { status: "done", ms: 60_000, sandboxMs: null },
    });
    // The checks run concurrently in one sandbox, so the run's wall clock is
    // the envelope (T0 to T90) and not the sum of the two lanes.
    expect(digest.durationMs).toBe(90_000);
  });

  it("leaves out a check that never appeared, rather than zeroing it", () => {
    const digest = deriveDigest({
      ...projection({ checks: [check({ title: "tests", startedAt: T0, endedAt: T30 })] }),
    });
    expect(Object.keys(digest.checks)).toEqual(["tests"]);
    expect(digest.checks.probes).toBeUndefined();
  });

  it("ignores a thread that is not one of the four checks", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "review", isCheck: false, startedAt: T0, endedAt: T90 }),
          check({ title: "smoke", startedAt: T0, endedAt: T30 }),
        ],
      }),
    );
    expect(Object.keys(digest.checks)).toEqual(["smoke"]);
    expect(digest.durationMs).toBe(30_000);
  });

  it("has no duration while a check is still running", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "tests", startedAt: T0, endedAt: T30 }),
          check({ title: "probes", status: "running", startedAt: T30, endedAt: null }),
        ],
      }),
    );
    expect(digest.checks.probes).toEqual({ status: "running", ms: null, sandboxMs: null });
    // Not 30_000. A partial envelope would read as a run that finished fast.
    expect(digest.durationMs).toBeNull();
  });

  /**
   * The fold records `startedAt` and `endedAt` in different event handlers, so
   * a projection can hold one check with only a start beside another with only
   * an end. Counting the two lists instead of pairing them per check finds
   * them equal, and the envelope then runs from one check's start to another
   * check's end — a duration nothing measured, on a run still going.
   */
  it("refuses an envelope built from two different half-stamped checks", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "tests", status: "running", startedAt: T0, endedAt: null }),
          check({ title: "probes", startedAt: null, endedAt: T90 }),
        ],
      }),
    );
    expect(digest.checks.tests).toEqual({ status: "running", ms: null, sandboxMs: null });
    expect(digest.checks.probes).toEqual({ status: "done", ms: null, sandboxMs: null });
    expect(digest.durationMs).toBeNull();
  });

  /**
   * A check stamped backwards reports `ms: null` on its own, but a second
   * check stamped forwards can still drag the aggregate envelope positive. The
   * envelope has to refuse whatever `checkMs` refuses, per check.
   */
  it("refuses an envelope when one check ends before it starts", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "tests", startedAt: T90, endedAt: T0 }),
          check({ title: "probes", startedAt: T0, endedAt: T90 }),
        ],
      }),
    );
    expect(digest.checks.tests?.ms).toBeNull();
    expect(digest.checks.probes?.ms).toBe(90_000);
    expect(digest.durationMs).toBeNull();
  });

  it("keeps a check that errored, with whatever it managed to measure", () => {
    const digest = deriveDigest(
      projection({ checks: [check({ title: "detonation", status: "error", startedAt: T0 })] }),
    );
    expect(digest.checks.detonation).toEqual({ status: "error", ms: null, sandboxMs: null });
    expect(digest.durationMs).toBeNull();
  });

  it("degrades to null on a projection written before the stamps existed", () => {
    const digest = deriveDigest(projection({ checks: [check({ title: "tests" })] }));
    expect(digest.checks.tests).toEqual({ status: "done", ms: null, sandboxMs: null });
    expect(digest.durationMs).toBeNull();
  });

  /**
   * The half of a check that was the sandbox executing the pull request, taken
   * off the timings the fold already computed rather than re-summed from the
   * report here. A second implementation of the same sum is the most direct way
   * to break this module's contract that two callers get the same answer.
   */
  it("carries how much of a check was the sandbox executing", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({
            title: "tests",
            startedAt: T0,
            endedAt: T30,
            timings: { wallMs: 30_000, sandboxMs: 21_000, modelMs: 9_000 },
          }),
        ],
      }),
    );
    expect(digest.checks.tests).toEqual({ status: "done", ms: 30_000, sandboxMs: 21_000 });
  });

  /**
   * Null and not zero, for the same reason `ms` is: a check whose report
   * carried no `runs[]` did not measure zero sandbox time, it measured none.
   * Zero would say the suite ran instantly.
   */
  it("has no sandbox share for a check that measured none", () => {
    const digest = deriveDigest(
      projection({
        checks: [
          check({ title: "tests", startedAt: T0, endedAt: T30, timings: { wallMs: 30_000 } }),
        ],
      }),
    );
    expect(digest.checks.tests?.sandboxMs).toBeNull();
  });

  it("counts every severity the product emits, zero included", () => {
    const digest = deriveDigest(
      projection({ findings: [finding("critical"), finding("warn"), finding("warn")] }),
    );
    expect(digest.findings).toEqual({ critical: 1, warn: 2, info: 0 });
  });

  it("counts the merged findings once, not the hard-rule hits again", () => {
    // `findings` already holds the hard-rule hits merged with the agent's, so
    // reading both would double every hard rule.
    const hit = finding("critical", "detonation");
    const digest = deriveDigest(projection({ findings: [hit], hardRuleHits: [hit] }));
    expect(digest.findings.critical).toBe(1);
  });

  it("says nothing at all about a run that never folded a check", () => {
    const digest = deriveDigest(emptyProjection());
    expect(digest).toEqual({
      checks: {},
      findings: { critical: 0, warn: 0, info: 0 },
      durationMs: null,
    });
  });
});
