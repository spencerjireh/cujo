import { chainPath, minSegment } from "@/lib/board/chain";
import { SPACING, slotZ } from "@/lib/board/chamber-layout";
import { scatterAt } from "@/lib/board/scatter";
import { SWEEP_SPAN, readStrength, sweepArc, sweepPhase } from "@/lib/board/sweep";
import { describe, expect, it } from "vitest";

/**
 * The sweep is the board re-reading the API (decision 68), and since decision
 * 70 it travels the chain rather than crossing as a plane.
 *
 * The claim worth asserting is the one nobody can check by looking: that it
 * reads the record **one run at a time**. A plane over a scattered field lights
 * everything at one depth together, which is what a cursor on the chain exists
 * to stop.
 */

/** The record as the scene builds it: ten runs, scattered, chained in order. */
function record(count = 10) {
  const points = Array.from({ length: count }, (_, i) => {
    const z = slotZ(i);
    const { x, y } = scatterAt(`run-${i}`, z);
    return { x, y, z };
  });
  return chainPath(points);
}

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

describe("sweepArc", () => {
  it("starts past the far end and finishes before the near one", () => {
    const path = record();
    // Both ends overshoot, so the first and last runs get a full read rather
    // than half of one.
    expect(sweepArc(0, path.length)).toBeGreaterThan(path.length);
    expect(sweepArc(1, path.length)).toBeLessThan(0);
  });

  it("only ever travels toward the newest run", () => {
    const path = record();
    let previous = Number.POSITIVE_INFINITY;
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const arc = sweepArc(phase, path.length);
      expect(arc).toBeLessThan(previous);
      previous = arc;
    }
  });

  it("clamps outside the interval rather than running on", () => {
    const path = record();
    expect(sweepArc(-2, path.length)).toBe(sweepArc(0, path.length));
    expect(sweepArc(4, path.length)).toBe(sweepArc(1, path.length));
  });
});

describe("readStrength", () => {
  it("peaks where the cursor meets the specimen", () => {
    expect(readStrength(4, 4)).toBe(1);
  });

  it("reads nothing far ahead of the cursor or far behind it", () => {
    expect(readStrength(4, 9)).toBe(0);
    expect(readStrength(4, -1)).toBe(0);
  });

  it("rises sharply into the cursor and settles slowly behind it", () => {
    // A specimen the cursor has not reached is anticipating; one it has passed
    // has just been read. Those are different events and are drawn differently.
    const ahead = readStrength(4, 4.15);
    const behind = readStrength(4, 3.85);
    expect(behind).toBeGreaterThan(ahead);
  });

  it("never returns a strength outside 0 to 1", () => {
    for (let delta = -3; delta <= 3; delta += 0.01) {
      const value = readStrength(4, 4 + delta);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("the sweep reads one run at a time", () => {
  const path = record();

  /**
   * The property the whole envelope exists for, and the defect it replaced: at
   * a reach of 1.1 against a spacing of 0.58, the old plane lit four specimens
   * together.
   */
  it("never lights two runs strongly at once, anywhere in a crossing", () => {
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const cursor = sweepArc(phase, path.length);
      const lit = path.arcs.filter((arc) => readStrength(cursor, arc) > 0.5);
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });

  it("reads every run at some point in the crossing", () => {
    const peaks = path.arcs.map(() => 0);
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const cursor = sweepArc(phase, path.length);
      path.arcs.forEach((arc, i) => {
        peaks[i] = Math.max(peaks[i] ?? 0, readStrength(cursor, arc));
      });
    }
    for (const peak of peaks) expect(peak).toBeGreaterThan(0.9);
  });

  /**
   * Why the property above holds, stated as arithmetic rather than as a sweep
   * of a particular record: the lit window is narrower than the tightest gap
   * between two runs. The scatter only ever pushes runs further apart than
   * their depth spacing, so `SPACING` is the floor.
   */
  it("keeps its lit window under the tightest gap on the chain", () => {
    expect(SWEEP_SPAN).toBeLessThan(SPACING);
    expect(SWEEP_SPAN).toBeLessThan(minSegment(path));
  });
});
