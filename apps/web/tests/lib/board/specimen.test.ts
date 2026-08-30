import type { RunDigest, RunStatus, RunSummary } from "@/lib/api/types";
import { armScale, specimenSignature, specimensFrom } from "@/lib/board/specimen";
import { describe, expect, it } from "vitest";

/**
 * The shape of a run.
 *
 * The chamber is only worth drawing if a specimen's silhouette is its evidence,
 * so these are the cases where a naive renderer would lie: a check that never
 * appeared drawn as a short arm, a running check drawn as a fast one, and one
 * slow run flattening every other specimen into a dot.
 */

const T0 = "2026-08-28T10:00:00.000Z";

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

function digest(checks: RunDigest["checks"]): RunDigest {
  return { checks, findings: { critical: 0, warn: 0, info: 0 }, durationMs: null };
}

/**
 * One entry in a digest's `checks`: a status, how long it ran, and how much of
 * that was the sandbox. `sandboxMs` defaults to null, which is the shape every
 * case here except the arm-split ones is about.
 */
function mark(
  status: "done" | "error" | "running",
  ms: number | null,
  sandboxMs: number | null = null,
) {
  return { status, ms, sandboxMs };
}

describe("armScale", () => {
  it("has no scale when nothing measured anything", () => {
    expect(armScale([])).toBeNull();
    expect(armScale([row({ id: "a", status: "superseded" })])).toBeNull();
  });

  it("takes p95, so one pathological run does not flatten the chamber", () => {
    const timed = (seconds: number[]) =>
      seconds.map((value, i) =>
        row({
          id: `r${i}`,
          status: "clean",
          digest: digest({ tests: { status: "done", ms: value * 1_000, sandboxMs: null } }),
        }),
      );
    const ordinary = Array.from({ length: 20 }, (_, i) => i + 1);
    // Twenty ordinary runs and one that took a quarter of an hour: the scale is
    // the twentieth, so every ordinary specimen stays legible instead of being
    // divided down to a dot by the outlier.
    expect(armScale(timed([...ordinary, 900]))).toBe(20_000);
    // Below about twenty measurements p95 is the top value, and it should be:
    // with four runs on the board there is no outlier to discount, only a
    // slowest run.
    expect(armScale(timed([1, 2, 3, 900]))).toBe(900_000);
  });
});

describe("specimensFrom", () => {
  it("draws no arm at all for a check that never appeared", () => {
    // A stub would claim the check ran briefly. The gap is the fact, and it is
    // the fact the hard rule `check_missing` exists for.
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "clean",
          digest: digest({ tests: { status: "done", ms: 5_000, sandboxMs: null } }),
        }),
      ],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("probes")).toMatchObject({ outcome: "absent", length: 0 });
    expect(byName.get("tests")?.length).toBeGreaterThan(0);
  });

  it("carries the check's own measurements on the bar, for the callout to say", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "clean",
          digest: digest({ tests: { status: "done", ms: 5_000, sandboxMs: 4_000 } }),
        }),
      ],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("tests")).toMatchObject({ ms: 5_000, sandboxMs: 4_000 });
    expect(byName.get("probes")).toMatchObject({ ms: null, sandboxMs: null });
  });

  it("gives a running check a length that never reads as measured", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "running",
          digest: digest({
            tests: { status: "running", ms: null, sandboxMs: null },
            probes: { status: "done", ms: 60_000, sandboxMs: null },
          }),
        }),
      ],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    const running = byName.get("tests");
    const measured = byName.get("probes");
    expect(running?.outcome).toBe("running");
    expect(running?.length).toBeGreaterThan(0);
    // The measured arm is the full scale; the unknown one is visibly shorter.
    expect(measured?.length).toBe(1);
    expect(running?.length).toBeLessThan(measured?.length ?? 0);
  });

  it("colours an arm by how its check ended, and the core by the verdict", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "blocked_pending",
          digest: digest({
            tests: { status: "done", ms: 1_000, sandboxMs: null },
            detonation: { status: "error", ms: null, sandboxMs: null },
          }),
        }),
      ],
      10,
    );
    // Amber lands on exactly one status, the one waiting on a person.
    expect(spec?.tone).toBe("amber");
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("detonation")?.tone).toBe("critical");
    // Bone, not a severity: a check that reported is the calm case, and four
    // of them on every run would otherwise out-shout the one that failed.
    expect(byName.get("tests")?.tone).toBe("bone");
  });

  /**
   * The second number an arm carries (decision 81). Length is how long the
   * check watched; the solid part is how much of that was the sandbox actually
   * executing the pull request, which is the same split `ChecksTimeline` draws
   * as a lane on the run page.
   */
  it("splits an arm at the share of the check that was the sandbox", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "clean",
          digest: digest({
            tests: mark("done", 40_000, 30_000),
            // No share measured: the arm is drawn whole, never all-model. A
            // zero here would say a check that ran a suite ran nothing.
            probes: mark("done", 20_000),
          }),
        }),
      ],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("tests")?.solid).toBeCloseTo(0.75, 10);
    expect(byName.get("probes")?.solid).toBeNull();
    // A check that never appeared has no arm, so it has no share of one.
    expect(byName.get("smoke")?.solid).toBeNull();
  });

  it("refuses a share of a duration nobody measured, and one that overflows", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "running",
          digest: digest({
            // Still running: no length to take a share of.
            tests: mark("running", null, 9_000),
            // A sandbox that reported longer than the thread it ran in is a
            // broken measurement, not an arm that overflows its own length.
            probes: mark("done", 10_000, 90_000),
          }),
        }),
      ],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("tests")?.solid).toBeNull();
    expect(byName.get("probes")?.solid).toBe(1);
  });

  it("orders newest first and trims to the chamber's capacity", () => {
    const runs = Array.from({ length: 8 }, (_, i) => row({ id: `r${i}`, status: "clean" }));
    const specs = specimensFrom(runs, 3);
    expect(specs.map((spec) => spec.id)).toEqual(["r0", "r1", "r2"]);
    expect(specs.map((spec) => spec.index)).toEqual([0, 1, 2]);
  });

  it("says when a run folded nothing, rather than drawing four dead arms", () => {
    const [spec] = specimensFrom([row({ id: "a", status: "superseded" })], 10);
    expect(spec?.unmeasured).toBe(true);
    expect(spec?.bars.every((bar) => bar.outcome === "absent")).toBe(true);
  });

  it("labels a specimen by title, falling back to the pull request", () => {
    const specs = specimensFrom(
      [
        row({ id: "a", status: "clean", pr_title: "Add a refund endpoint" }),
        row({ id: "b", status: "clean", pr_number: 42 }),
      ],
      10,
    );
    expect(specs[0]?.label).toBe("Add a refund endpoint");
    expect(specs[1]?.label).toBe("o/r #42");
  });
});

/**
 * What the run found, as part of its shape. `digest.findings` is the field
 * decision 65 put on every list row, and until now the chamber drew none of it.
 */
describe("specimensFrom findings", () => {
  const found = (findings: RunDigest["findings"]) => ({
    checks: {},
    findings,
    durationMs: 1_000,
  });

  it("strings one mark per finding, worst nearest the core", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "blocked_posted",
          digest: found({ critical: 1, warn: 2, info: 1 }),
        }),
      ],
      10,
    );
    expect(spec?.findingTotal).toBe(4);
    expect(spec?.marks.map((mark) => mark.severity)).toEqual(["critical", "warn", "warn", "info"]);
    // Amber on a warn, per the severity ramp: `warn` renders as `high`.
    expect(spec?.marks.map((mark) => mark.tone)).toEqual(["critical", "amber", "amber", "info"]);
  });

  it("caps the marks but never the count", () => {
    // Past the cap the marks merge into a dashed line, so drawing more would
    // claim a precision the drawing has lost. The number still has to be right.
    const [spec] = specimensFrom(
      [row({ id: "a", status: "clean", digest: found({ critical: 0, warn: 0, info: 40 }) })],
      10,
    );
    expect(spec?.marks).toHaveLength(6);
    expect(spec?.findingTotal).toBe(40);
  });

  it("sizes the core by the worst severity, not by how many there are", () => {
    const [one] = specimensFrom(
      [row({ id: "a", status: "clean", digest: found({ critical: 1, warn: 0, info: 0 }) })],
      10,
    );
    const [many] = specimensFrom(
      [row({ id: "b", status: "clean", digest: found({ critical: 3, warn: 9, info: 9 }) })],
      10,
    );
    const [none] = specimensFrom(
      [row({ id: "c", status: "clean", digest: found({ critical: 0, warn: 0, info: 0 }) })],
      10,
    );
    // A run with three criticals is not more dangerous than one with one.
    expect(one?.coreScale).toBe(many?.coreScale);
    expect(none?.coreScale).toBe(1);
    expect(one?.worst).toBe("critical");
    expect(none?.worst).toBeNull();
  });

  it("draws no marks on a run that folded nothing, and does not call that clean", () => {
    // The two are different claims: this run found nothing *that anyone knows
    // of*, which `unmeasured` says and a bare zero would not.
    const [spec] = specimensFrom([row({ id: "a", status: "superseded" })], 10);
    expect(spec?.marks).toEqual([]);
    expect(spec?.findingTotal).toBe(0);
    expect(spec?.worst).toBeNull();
    expect(spec?.unmeasured).toBe(true);
  });
});

/**
 * What the chamber compares to decide whether a poll changed a drawing.
 *
 * The list is refetched every five seconds and comes back equal almost every
 * time, so "changed" has to mean *would be drawn differently* rather than "is a
 * new object" — otherwise every poll rebuilds twenty-four nodes to redraw the
 * same picture.
 */
describe("specimenSignature", () => {
  const one = (over: Partial<RunSummary> & { id: string; status: RunStatus }) => {
    const [spec] = specimensFrom([row(over)], 10);
    if (!spec) throw new Error("no specimen");
    return spec;
  };

  it("is the same for two runs that would be drawn identically", () => {
    const a = one({ id: "a", status: "clean", digest: digest({ tests: mark("done", 1_000) }) });
    const b = one({ id: "b", status: "clean", digest: digest({ tests: mark("done", 1_000) }) });
    expect(specimenSignature(a)).toBe(specimenSignature(b));
  });

  it("changes when a check ends differently", () => {
    const running = one({
      id: "a",
      status: "running",
      digest: digest({ tests: mark("running", null) }),
    });
    const errored = one({
      id: "a",
      status: "clean",
      digest: digest({ tests: mark("error", 900) }),
    });
    expect(specimenSignature(running)).not.toBe(specimenSignature(errored));
  });

  it("changes when the verdict changes", () => {
    const pending = one({ id: "a", status: "blocked_pending" });
    const posted = one({ id: "a", status: "blocked_posted" });
    expect(specimenSignature(pending)).not.toBe(specimenSignature(posted));
  });

  /**
   * A poll that learns only where a check's time went still changes the
   * drawing: the arm's solid part moves. Left out of the signature, the old
   * geometry would stand and the specimen would keep a division it no longer
   * has.
   */
  it("changes when only the sandbox share of a check changes", () => {
    const whole = one({ id: "a", status: "clean", digest: digest({ tests: mark("done", 4_000) }) });
    const split = one({
      id: "a",
      status: "clean",
      digest: digest({ tests: mark("done", 4_000, 3_000) }),
    });
    expect(specimenSignature(whole)).not.toBe(specimenSignature(split));
  });

  it("changes when the findings do", () => {
    const clean = one({
      id: "a",
      status: "clean",
      digest: { checks: {}, findings: { critical: 0, warn: 0, info: 0 }, durationMs: null },
    });
    const found = one({
      id: "a",
      status: "clean",
      digest: { checks: {}, findings: { critical: 1, warn: 0, info: 0 }, durationMs: null },
    });
    expect(specimenSignature(clean)).not.toBe(specimenSignature(found));
  });

  /**
   * The one exclusion, and the reason the record can slide: a run that only
   * moved a slot back is the same specimen and must not be rebuilt.
   */
  it("does not change when a run only moves down the record", () => {
    const [first, second] = specimensFrom(
      [
        row({ id: "new", status: "clean", digest: digest({ tests: mark("done", 1_000) }) }),
        row({ id: "a", status: "clean", digest: digest({ tests: mark("done", 1_000) }) }),
      ],
      10,
    );
    if (!first || !second) throw new Error("no specimens");
    expect(first.index).not.toBe(second.index);
    expect(specimenSignature(first)).toBe(specimenSignature(second));
  });
});
