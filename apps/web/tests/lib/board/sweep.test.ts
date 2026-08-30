import { BACK_Z, FRONT_Z, LAYER_COUNT, LAYER_SPACING, layerZ } from "@/lib/board/chamber-layout";
import { SWEEP_SPAN, readStrength, sweepPhase, sweepZ } from "@/lib/board/sweep";
import { describe, expect, it } from "vitest";

/**
 * The sweep is the board re-reading the API (decision 68). It is a plane
 * again since decision 71, because the record is layers and a layer is one
 * depth.
 *
 * The claim worth asserting is the one nobody can check by looking: that it
 * reads the record **one layer at a time**.
 */

const LAYERS = Array.from({ length: LAYER_COUNT }, (_, i) => layerZ(i));

describe("sweepPhase", () => {
  it("reports nothing before the first poll has landed", () => {
    expect(sweepPhase(3, -1, 5)).toBeNull();
  });

  it("runs 0 to 1 across the interval the board is polling at", () => {
    expect(sweepPhase(10, 10, 5)).toBe(0);
    expect(sweepPhase(12.5, 10, 5)).toBe(0.5);
    expect(sweepPhase(15, 10, 5)).toBe(1);
  });

  it("ends rather than looping once the sweep is over", () => {
    // The plane is the read, not a timer: it waits for the next one.
    expect(sweepPhase(16, 10, 5)).toBeNull();
  });

  it("reports nothing for an interval of no length", () => {
    expect(sweepPhase(10, 10, 0)).toBeNull();
  });
});

describe("sweepZ", () => {
  it("starts behind the oldest layer and finishes in front of the newest", () => {
    // Both ends overshoot, so the first and last layers get a full read rather
    // than half of one.
    expect(sweepZ(0)).toBeLessThan(BACK_Z);
    expect(sweepZ(1)).toBeGreaterThan(FRONT_Z);
  });

  it("only ever travels toward the newest layer", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const z = sweepZ(phase);
      expect(z).toBeGreaterThan(previous);
      previous = z;
    }
  });

  it("clamps outside the interval rather than running on", () => {
    expect(sweepZ(-2)).toBe(sweepZ(0));
    expect(sweepZ(4)).toBe(sweepZ(1));
  });
});

describe("readStrength", () => {
  it("peaks where the plane meets the layer", () => {
    expect(readStrength(-4, -4)).toBe(1);
  });

  it("reads nothing far ahead of the plane or far behind it", () => {
    expect(readStrength(-4, 1)).toBe(0);
    expect(readStrength(-4, -9)).toBe(0);
  });

  it("rises sharply into the plane and settles slowly behind it", () => {
    // A layer the plane has not reached is anticipating; one it has passed
    // has just been read. Those are different events and are drawn differently.
    const ahead = readStrength(-4, -3.85);
    const behind = readStrength(-4, -4.15);
    expect(behind).toBeGreaterThan(ahead);
  });

  it("never returns a strength outside 0 to 1", () => {
    for (let delta = -3; delta <= 3; delta += 0.01) {
      const value = readStrength(-4, -4 + delta);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("the sweep reads one layer at a time", () => {
  it("never lights two layers strongly at once, anywhere in a crossing", () => {
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const plane = sweepZ(phase);
      const lit = LAYERS.filter((z) => readStrength(plane, z) > 0.5);
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });

  it("reads every layer at some point in the crossing", () => {
    const peaks = LAYERS.map(() => 0);
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const plane = sweepZ(phase);
      LAYERS.forEach((z, i) => {
        peaks[i] = Math.max(peaks[i] ?? 0, readStrength(plane, z));
      });
    }
    for (const peak of peaks) expect(peak).toBeGreaterThan(0.9);
  });

  /**
   * Why the property above holds, stated as arithmetic rather than as a sweep
   * of a particular record: the lit window is shallower than a layer.
   */
  it("keeps its lit window under one layer's spacing", () => {
    expect(SWEEP_SPAN).toBeLessThan(LAYER_SPACING);
  });
});
