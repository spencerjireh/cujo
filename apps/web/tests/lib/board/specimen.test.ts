import type { RunDigest, RunStatus, RunSummary } from "@/lib/api/types";
import { armScale, specimensFrom } from "@/lib/board/specimen";
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
          digest: digest({ tests: { status: "done", ms: value * 1_000 } }),
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
      [row({ id: "a", status: "clean", digest: digest({ tests: { status: "done", ms: 5_000 } }) })],
      10,
    );
    const byName = new Map(spec?.bars.map((bar) => [bar.name, bar]));
    expect(byName.get("probes")).toMatchObject({ outcome: "absent", length: 0 });
    expect(byName.get("tests")?.length).toBeGreaterThan(0);
  });

  it("gives a running check a length that never reads as measured", () => {
    const [spec] = specimensFrom(
      [
        row({
          id: "a",
          status: "running",
          digest: digest({
            tests: { status: "running", ms: null },
            probes: { status: "done", ms: 60_000 },
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
            tests: { status: "done", ms: 1_000 },
            detonation: { status: "error", ms: null },
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
