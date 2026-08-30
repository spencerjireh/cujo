import type { Severity } from "@/lib/api/types";
import { SEVERITY_TONE, compareFindings, findingTotal, worstSeverity } from "@/lib/board/tone";
import { describe, expect, it } from "vitest";

/**
 * The severity vocabulary the board draws with. `digest.findings` reaches three
 * renderers — a specimen's marks, a record row, the rack's fifth panel — and
 * these are the rules all three share.
 */

const counts = (over: Partial<Record<Severity, number>> = {}) => ({
  critical: 0,
  warn: 0,
  info: 0,
  ...over,
});

describe("SEVERITY_TONE", () => {
  it("puts warn on the amber ramp, per brand.md", () => {
    // The product emits three severities and `warn` renders as `high`, which
    // is the amber one. Giving it a hue of its own would put a fourth colour
    // in a drawing that has four.
    expect(SEVERITY_TONE).toEqual({ critical: "critical", warn: "amber", info: "info" });
  });
});

describe("worstSeverity", () => {
  it("reports the worst present, not the most common", () => {
    expect(worstSeverity(counts({ info: 40, warn: 1 }))).toBe("warn");
    expect(worstSeverity(counts({ info: 40, warn: 9, critical: 1 }))).toBe("critical");
  });

  it("is null when a run found nothing, and when it folded nothing", () => {
    expect(worstSeverity(counts())).toBeNull();
    expect(worstSeverity(undefined)).toBeNull();
  });
});

describe("findingTotal", () => {
  it("counts across every severity", () => {
    expect(findingTotal(counts({ critical: 1, warn: 2, info: 3 }))).toBe(6);
    expect(findingTotal(counts())).toBe(0);
    expect(findingTotal(undefined)).toBe(0);
  });
});

describe("compareFindings", () => {
  it("ranks a single critical above any number of warns", () => {
    // The case a folded weight gets wrong. `critical * 10_000 + warn * 100`
    // puts 101 warns above one critical, and the counts come off an unbounded
    // findings array, so no multiplier is large enough. This has to hold at
    // any count at all.
    expect(compareFindings(counts({ critical: 1 }), counts({ warn: 101 }))).toBeGreaterThan(0);
    expect(compareFindings(counts({ critical: 1 }), counts({ warn: 1_000_000 }))).toBeGreaterThan(
      0,
    );
    expect(compareFindings(counts({ warn: 1 }), counts({ info: 5_000 }))).toBeGreaterThan(0);
  });

  it("falls through to the next rank only on a tie", () => {
    expect(compareFindings(counts({ critical: 2, warn: 1 }), counts({ critical: 2 }))).toBe(1);
    expect(
      compareFindings(counts({ critical: 2, info: 3 }), counts({ critical: 2, info: 3 })),
    ).toBe(0);
  });

  it("sorts a run that folded nothing below one that found nothing", () => {
    // Different claims: one is the absence of a measurement, the other is a
    // result. The column draws them differently too — an em dash and "none".
    expect(compareFindings(null, counts())).toBeLessThan(0);
    expect(compareFindings(counts(), null)).toBeGreaterThan(0);
    expect(compareFindings(null, undefined)).toBe(0);
  });
});
