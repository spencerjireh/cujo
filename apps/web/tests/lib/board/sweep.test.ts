import { BACK_Z, FRONT_Z, SPACING, slotZ } from "@/lib/board/chamber-layout";
import { readStrength, readingIndex, sweepPhase, sweepPlaneZ } from "@/lib/board/sweep";
import { describe, expect, it } from "vitest";

describe("sweepPhase", () => {
  it("reports nothing before the first poll lands", () => {
    expect(sweepPhase(10, -1, 5)).toBeNull();
  });

  it("runs from 0 to 1 across the interval", () => {
    expect(sweepPhase(10, 10, 5)).toBe(0);
    expect(sweepPhase(12.5, 10, 5)).toBe(0.5);
    expect(sweepPhase(15, 10, 5)).toBe(1);
  });

  it("ends rather than looping once the sweep is over", () => {
    // The plane is the board waiting on the next read; past the interval there
    // is nothing to draw until one lands.
    expect(sweepPhase(15.1, 10, 5)).toBeNull();
  });
});

describe("sweepPlaneZ", () => {
  it("crosses the volume from the back wall to past the open face", () => {
    expect(sweepPlaneZ(0)).toBeCloseTo(BACK_Z, 6);
    expect(sweepPlaneZ(1)).toBeGreaterThan(FRONT_Z);
  });

  it("only ever moves forward", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let phase = 0; phase <= 1; phase += 0.05) {
      const z = sweepPlaneZ(phase);
      expect(z).toBeGreaterThan(previous);
      previous = z;
    }
  });
});

describe("readStrength", () => {
  it("peaks where the plane meets the specimen", () => {
    expect(readStrength(0, 0)).toBe(1);
  });

  it("reads nothing far ahead or far behind", () => {
    expect(readStrength(-5, 0)).toBe(0);
    expect(readStrength(5, 0)).toBe(0);
  });

  it("rises sharply into a specimen and settles slowly behind it", () => {
    // Not symmetric on purpose: a specimen the plane has not reached is
    // anticipating, and one it has passed has just been read.
    const before = readStrength(-0.15, 0);
    const after = readStrength(0.15, 0);
    expect(after).toBeGreaterThan(before);
  });

  it("never returns a strength outside 0 and 1", () => {
    for (let d = -2; d <= 2; d += 0.01) {
      const value = readStrength(d, 0);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The defect this envelope replaces, stated as a property.
   *
   * The old falloff reached 1.1 scene units against a slot spacing of 0.58, so
   * four specimens brightened together and the sweep read as a glow passing
   * over the record rather than as one measurement at a time.
   */
  it("never strongly lights two specimens at once, anywhere in a crossing", () => {
    const slots = Array.from({ length: 24 }, (_, i) => slotZ(i));
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const planeZ = sweepPlaneZ(phase);
      const lit = slots.filter((z) => readStrength(planeZ, z) > 0.5);
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });

  it("reads every specimen at some point in a crossing", () => {
    const slots = Array.from({ length: 24 }, (_, i) => slotZ(i));
    for (const z of slots) {
      let peak = 0;
      for (let phase = 0; phase <= 1; phase += 0.002) {
        peak = Math.max(peak, readStrength(sweepPlaneZ(phase), z));
      }
      expect(peak).toBeGreaterThan(0.9);
    }
  });
});

describe("readingIndex", () => {
  it("names the slot the plane is over", () => {
    expect(readingIndex(slotZ(0), 24)).toBe(0);
    expect(readingIndex(slotZ(7), 24)).toBe(7);
  });

  it("names nothing past the end of the record", () => {
    expect(readingIndex(slotZ(30), 24)).toBeNull();
    expect(readingIndex(FRONT_Z + 5, 24)).toBeNull();
    expect(readingIndex(slotZ(0), 0)).toBeNull();
  });

  it("names the nearer slot when the plane sits between two", () => {
    // Slots recede, so a higher z is a lower index: just short of the midpoint
    // the plane is still reading slot 3, just past it slot 4.
    const midpoint = slotZ(3) - SPACING / 2;
    expect(readingIndex(midpoint + 0.01, 24)).toBe(3);
    expect(readingIndex(midpoint - 0.01, 24)).toBe(4);
  });
});
