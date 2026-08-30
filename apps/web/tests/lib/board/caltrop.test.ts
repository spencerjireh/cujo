import { CHECK_NAMES } from "@/lib/api/types";
import {
  ARM_DIRECTIONS,
  MARK_SLOTS,
  PROJECTED_REACH,
  markRing,
  projectArms,
} from "@/lib/board/caltrop";
import { describe, expect, it } from "vitest";

/**
 * The specimen's geometry. Three claims are worth pinning, and all three are
 * the sort that read as obvious and are not:
 *
 * 1. The four arms really are as far apart as four directions can be.
 * 2. Projected flat, they land exactly where the specimen has always been
 *    drawn — which is what lets the run page's glyph and the legend's diagram
 *    stay the same drawing as the object in the chamber.
 * 3. No mark ever sits on top of an arm.
 */

const degrees = (radians: number) => (radians * 180) / Math.PI;

function angleBetween(a: { x: number; y: number; z: number }, b: typeof a): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return degrees(Math.acos(Math.max(-1, Math.min(1, dot))));
}

describe("ARM_DIRECTIONS", () => {
  it("has one direction per check, in the order the checks are named", () => {
    expect(ARM_DIRECTIONS).toHaveLength(CHECK_NAMES.length);
  });

  it("is unit length, so an arm's reach is its measurement and nothing else", () => {
    for (const d of ARM_DIRECTIONS) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 10);
    }
  });

  /**
   * The tetrahedral angle. Any four directions closer together than this leave
   * two arms sharing a region of the frame, and a lopsided specimen stops being
   * readable from across the volume.
   */
  it("spreads the four arms as far apart as four directions can be", () => {
    for (let i = 0; i < ARM_DIRECTIONS.length; i += 1) {
      for (let j = i + 1; j < ARM_DIRECTIONS.length; j += 1) {
        const a = ARM_DIRECTIONS[i];
        const b = ARM_DIRECTIONS[j];
        if (!a || !b) throw new Error("unreachable");
        expect(angleBetween(a, b)).toBeCloseTo(109.4712, 3);
      }
    }
  });

  it("uses all three axes, so the shape is a solid and not a plate", () => {
    // A flat specimen is one where every arm shares a plane. Nothing about the
    // object is then revealed as the camera moves, which is the defect.
    expect(new Set(ARM_DIRECTIONS.map((d) => Math.sign(d.z)))).toEqual(new Set([1, -1]));
  });
});

describe("projectArms", () => {
  it("names every check, in order", () => {
    expect(projectArms(1).map((arm) => arm.name)).toEqual([...CHECK_NAMES]);
  });

  /**
   * The whole reason this projection is worth having. The specimen has always
   * been four arms on the 45° diagonals; the solid projects onto exactly those,
   * so the flat drawings did not have to change and the two are one drawing.
   */
  it("lands each check in the quadrant it has always been drawn in", () => {
    const [tests, probes, smoke, detonation] = projectArms(1);
    if (!tests || !probes || !smoke || !detonation) throw new Error("unreachable");
    // Screen coordinates: y runs down.
    expect([Math.sign(tests.x), Math.sign(tests.y)]).toEqual([-1, -1]);
    expect([Math.sign(probes.x), Math.sign(probes.y)]).toEqual([1, -1]);
    expect([Math.sign(smoke.x), Math.sign(smoke.y)]).toEqual([1, 1]);
    expect([Math.sign(detonation.x), Math.sign(detonation.y)]).toEqual([-1, 1]);
    for (const arm of [tests, probes, smoke, detonation]) {
      expect(Math.abs(degrees(Math.atan2(arm.y, arm.x))) % 90).toBeCloseTo(45, 6);
    }
  });

  it("shortens every arm by the same amount, so the projection is not a ranking", () => {
    // Four arms foreshortened differently would draw a run whose checks took
    // equal time as one that did not.
    for (const arm of projectArms(10)) {
      expect(Math.hypot(arm.x, arm.y)).toBeCloseTo(10 * PROJECTED_REACH, 10);
    }
  });

  it("scales with the reach it is given", () => {
    const near = projectArms(1)[0];
    const far = projectArms(3)[0];
    if (!near || !far) throw new Error("unreachable");
    expect(far.x / near.x).toBeCloseTo(3, 10);
  });

  it("says which arms point toward the viewer and which away", () => {
    const depths = projectArms(1).map((arm) => Math.sign(arm.depth));
    expect(depths.filter((d) => d > 0)).toHaveLength(2);
    expect(depths.filter((d) => d < 0)).toHaveLength(2);
  });
});

describe("markRing", () => {
  it("draws nothing for a run that found nothing", () => {
    expect(markRing(0)).toEqual([]);
    expect(markRing(-1)).toEqual([]);
  });

  it("fills fixed slots in order, so the ring carries its own scale", () => {
    // A run with one finding occupies a sixth of the ring and a run with six
    // fills it. Marks spread to fit would look the same at every count.
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const ring = markRing(count);
      expect(ring).toHaveLength(count);
      const gaps = ring.slice(1).map((angle, i) => angle - (ring[i] ?? 0));
      for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / MARK_SLOTS, 10);
    }
    expect(markRing(1)).toEqual(markRing(6).slice(0, 1));
  });

  it("stops at the cap rather than lapping the ring", () => {
    expect(markRing(40)).toHaveLength(MARK_SLOTS);
    expect(markRing(MARK_SLOTS)).toEqual(markRing(MARK_SLOTS + 1));
  });

  /**
   * The arms leave the core on the diagonals, so a mark on a diagonal sits
   * underneath one. The offset exists for this and nothing else.
   */
  it("never puts a mark on an arm", () => {
    const arms = projectArms(1).map((arm) => Math.atan2(arm.y, arm.x));
    for (const count of [1, 2, 3, 4, 5, 6]) {
      for (const angle of markRing(count)) {
        for (const arm of arms) {
          const gap = Math.abs(((angle - arm + Math.PI) % (2 * Math.PI)) - Math.PI);
          expect(degrees(gap)).toBeGreaterThan(6);
        }
      }
    }
  });
});
