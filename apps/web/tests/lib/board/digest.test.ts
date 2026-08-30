import type { Finding, Run } from "@/lib/api/types";
import { digestFrom } from "@/lib/board/digest";
import { check, run } from "@/lib/fixtures";
import { describe, expect, it } from "vitest";

const T0 = "2026-08-28T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

function finding(over: Partial<Finding> = {}): Finding {
  return {
    source: "agent",
    check: "tests",
    severity: "warn",
    title: "a finding",
    evidence: "",
    ...over,
  };
}

/** A run carrying exactly the checks and findings a case is about. */
function subject(over: Partial<Run>): Run {
  return run({ checks: [], findings: [], hard_rule_hits: [], ...over });
}

describe("digestFrom", () => {
  it("keys the four named checks by name", () => {
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "tests", startedAt: at(0), endedAt: at(30) }),
          check({ title: "detonation", startedAt: at(5), endedAt: at(20), status: "error" }),
        ],
      }),
    );
    expect(digest.checks.tests).toEqual({ status: "done", ms: 30_000 });
    expect(digest.checks.detonation).toEqual({ status: "error", ms: 15_000 });
  });

  it("leaves out a check that never appeared, rather than zeroing it", () => {
    // The board must draw an absent check differently from one that ran and
    // passed — `check_missing` is a hard rule precisely because they differ.
    const digest = digestFrom(subject({ checks: [check({ title: "tests" })] }));
    expect(digest.checks.smoke).toBeUndefined();
    expect("smoke" in digest.checks).toBe(false);
  });

  it("ignores a thread the rubric did not name for a check", () => {
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "main", isCheck: false }),
          check({ title: "some helper", isCheck: true }),
          check({ title: "probes" }),
        ],
      }),
    );
    expect(Object.keys(digest.checks)).toEqual(["probes"]);
  });

  it("takes the earlier thread when two carry one check's name", () => {
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "tests", startedAt: at(0), endedAt: at(10) }),
          check({ title: "tests", startedAt: at(0), endedAt: at(90), status: "error" }),
        ],
      }),
    );
    expect(digest.checks.tests).toEqual({ status: "done", ms: 10_000 });
  });

  it("reports no duration for a check still running", () => {
    const digest = digestFrom(
      subject({ checks: [check({ title: "tests", startedAt: at(0), endedAt: null })] }),
    );
    expect(digest.checks.tests).toEqual({ status: "done", ms: null });
  });

  it("reports no duration for a check stamped backwards", () => {
    const digest = digestFrom(
      subject({ checks: [check({ title: "tests", startedAt: at(30), endedAt: at(10) })] }),
    );
    expect(digest.checks.tests?.ms).toBeNull();
  });

  it("counts findings by severity, and never invents a key", () => {
    const digest = digestFrom(
      subject({
        findings: [
          finding({ severity: "critical" }),
          finding({ severity: "critical" }),
          finding({ severity: "info" }),
        ],
      }),
    );
    expect(digest.findings).toEqual({ critical: 2, warn: 0, info: 1 });
  });

  it("ignores a severity the fold does not emit", () => {
    const digest = digestFrom(
      subject({ findings: [{ ...finding(), severity: "medium" as never }] }),
    );
    expect(digest.findings).toEqual({ critical: 0, warn: 0, info: 0 });
  });

  it("measures the run as the envelope around the checks, not their sum", () => {
    // They run concurrently in one sandbox, so 30s and 20s overlapping is a
    // 35-second run and never a 50-second one.
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "tests", startedAt: at(0), endedAt: at(30) }),
          check({ title: "probes", startedAt: at(15), endedAt: at(35) }),
        ],
      }),
    );
    expect(digest.durationMs).toBe(35_000);
  });

  it("reports no duration while any check is still going", () => {
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "tests", startedAt: at(0), endedAt: at(30) }),
          check({ title: "probes", startedAt: at(15), endedAt: null }),
        ],
      }),
    );
    expect(digest.durationMs).toBeNull();
  });

  it("reports no duration for a run with no checks folded", () => {
    expect(digestFrom(subject({ checks: [] })).durationMs).toBeNull();
  });

  it("refuses an envelope built from a check stamped backwards", () => {
    // Its own `ms` is correctly null, and the aggregate must refuse the same
    // interval — otherwise a backwards check beside a forwards one produces a
    // positive span nothing measured.
    const digest = digestFrom(
      subject({
        checks: [
          check({ title: "tests", startedAt: at(30), endedAt: at(10) }),
          check({ title: "probes", startedAt: at(0), endedAt: at(40) }),
        ],
      }),
    );
    expect(digest.durationMs).toBeNull();
  });
});
