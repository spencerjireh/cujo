import { CHECK_NAMES } from "@/lib/api/types";
import {
  PROJECTED_SQUASH,
  RING_NORMALS,
  SATELLITE_SLOTS,
  projectRing,
  ringBasis,
  ringPoint,
  satelliteRing,
} from "@/lib/board/orbit";
import { describe, expect, it } from "vitest";

/**
 * A run's orbits. Three claims worth pinning, all of the sort that read as
 * obvious and are not:
 *
 * 1. The four ring planes really are as far apart as four planes can be.
 * 2. Projected flat, every ring is the same ellipse squashed along a different
 *    diagonal — which is what lets the run page's glyph and the legend's
 *    diagram stay the same drawing as the object in the chamber.
 * 3. The bright arc and the faint arc make one closed ring between them.
 */

const degrees = (radians: number) => (radians * 180) / Math.PI;

function angleBetween(a: { x: number; y: number; z: number }, b: typeof a): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return degrees(Math.acos(Math.max(-1, Math.min(1, dot))));
}

describe("RING_NORMALS", () => {
  it("has one ring per check, in the order the checks are named", () => {
    expect(RING_NORMALS).toHaveLength(CHECK_NAMES.length);
  });

  it("is unit length, so a ring's radius is its measurement and nothing else", () => {
    for (const n of RING_NORMALS) expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10);
  });

  it("spreads the four planes as far apart as four planes can be", () => {
    for (let i = 0; i < RING_NORMALS.length; i += 1) {
      for (let j = i + 1; j < RING_NORMALS.length; j += 1) {
        const a = RING_NORMALS[i];
        const b = RING_NORMALS[j];
        if (!a || !b) throw new Error("unreachable");
        expect(angleBetween(a, b)).toBeCloseTo(109.4712, 3);
      }
    }
  });

  it("never lies flat to the reader, so every ring is seen as a ring", () => {
    // A ring with its normal on the view axis is a circle; one with its normal
    // across it is a line. Both lose the tilt that says which check it is.
    for (const n of RING_NORMALS) {
      expect(Math.abs(n.z)).toBeGreaterThan(0.2);
      expect(Math.abs(n.z)).toBeLessThan(0.9);
    }
  });
});

describe("ringBasis", () => {
  it("is orthonormal and in the ring's plane", () => {
    for (const n of RING_NORMALS) {
      const { u, v } = ringBasis(n);
      expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 10);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 10);
      expect(u.x * v.x + u.y * v.y + u.z * v.z).toBeCloseTo(0, 10);
      expect(u.x * n.x + u.y * n.y + u.z * n.z).toBeCloseTo(0, 10);
      expect(v.x * n.x + v.y * n.y + v.z * n.z).toBeCloseTo(0, 10);
    }
  });

  it("starts every ring's arc from a point that lies flat", () => {
    // The bright arc begins at `u` on every ring of every run, which is what
    // makes two runs' execution shares comparable by eye.
    for (const n of RING_NORMALS) expect(ringBasis(n).u.y).toBeCloseTo(0, 10);
  });
});

describe("ringPoint", () => {
  it("stays at the radius and in the plane, all the way round", () => {
    for (const n of RING_NORMALS) {
      for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
        const p = ringPoint(n, 0.4, angle);
        expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(0.4, 10);
        expect(p.x * n.x + p.y * n.y + p.z * n.z).toBeCloseTo(0, 10);
      }
    }
  });
});

describe("projectRing", () => {
  it("names every check, in order", () => {
    expect(RING_NORMALS.map((_, i) => projectRing(i, 1, 1).name)).toEqual([...CHECK_NAMES]);
  });

  /**
   * The whole reason the tetrahedral set is worth keeping as normals: every
   * ring is the same ellipse, so the projection is not a ranking of the checks.
   */
  it("projects every ring to the same ellipse, squashed by the same amount", () => {
    for (let i = 0; i < RING_NORMALS.length; i += 1) {
      const radii = projectRing(i, 1, null, 720).bright.map((p) => Math.hypot(p.x, p.y));
      expect(Math.max(...radii)).toBeCloseTo(1, 3);
      expect(Math.min(...radii)).toBeCloseTo(PROJECTED_SQUASH, 3);
    }
  });

  /**
   * The specimen has always put `tests` upper-left and `detonation` lower-left.
   * Each ring's minor axis — the direction it is squashed along — lies on that
   * check's diagonal, so the quadrant a reader learned still belongs to it.
   */
  it("squashes each ring along the diagonal its check has always been drawn on", () => {
    const expected: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let i = 0; i < RING_NORMALS.length; i += 1) {
      const points = projectRing(i, 1, null, 720).bright;
      let nearest = points[0];
      if (!nearest) throw new Error("unreachable");
      for (const p of points) {
        if (Math.hypot(p.x, p.y) < Math.hypot(nearest.x, nearest.y)) nearest = p;
      }
      // Screen coordinates: y runs down. The minor axis is a line, so either
      // end is the same axis.
      const sign = expected[i];
      if (!sign) throw new Error("unreachable");
      const along = Math.sign(nearest.x) === sign[0] && Math.sign(nearest.y) === sign[1];
      const opposite = Math.sign(nearest.x) === -sign[0] && Math.sign(nearest.y) === -sign[1];
      expect(along || opposite).toBe(true);
      expect(Math.abs(degrees(Math.atan2(nearest.y, nearest.x))) % 90).toBeCloseTo(45, 1);
    }
  });

  it("closes the ring between the bright arc and the faint one", () => {
    for (const share of [0.1, 0.35, 0.5, 0.8]) {
      const ring = projectRing(0, 1, share);
      const brightEnd = ring.bright[ring.bright.length - 1];
      const faintStart = ring.faint[0];
      const faintEnd = ring.faint[ring.faint.length - 1];
      const brightStart = ring.bright[0];
      if (!brightEnd || !faintStart || !faintEnd || !brightStart) throw new Error("unreachable");
      expect(faintStart.x).toBeCloseTo(brightEnd.x, 10);
      expect(faintStart.y).toBeCloseTo(brightEnd.y, 10);
      expect(faintEnd.x).toBeCloseTo(brightStart.x, 10);
      expect(faintEnd.y).toBeCloseTo(brightStart.y, 10);
    }
  });

  it("draws a whole ring, and no faint arc, for a share nobody measured", () => {
    // Null is not zero: a zero would draw a ring that was all thinking on a
    // check that ran a test suite.
    const ring = projectRing(1, 1, null);
    expect(ring.faint).toEqual([]);
    const first = ring.bright[0];
    const last = ring.bright[ring.bright.length - 1];
    if (!first || !last) throw new Error("unreachable");
    expect(last.x).toBeCloseTo(first.x, 10);
    expect(last.y).toBeCloseTo(first.y, 10);
  });

  it("gives the bright arc its share of the ring", () => {
    const ring = projectRing(2, 1, 0.25, 400);
    expect(ring.bright.length - 1).toBe(100);
    expect(ring.faint.length - 1).toBe(300);
  });

  it("scales with the radius it is given", () => {
    const near = projectRing(0, 1, null).bright[0];
    const far = projectRing(0, 3, null).bright[0];
    if (!near || !far) throw new Error("unreachable");
    expect(far.x / near.x).toBeCloseTo(3, 10);
  });

  it("refuses a ring that does not exist", () => {
    expect(() => projectRing(4, 1, null)).toThrow(RangeError);
  });
});

describe("satelliteRing", () => {
  it("draws nothing for a run that found nothing", () => {
    expect(satelliteRing(0)).toEqual([]);
    expect(satelliteRing(-1)).toEqual([]);
  });

  it("fills fixed slots in order, so the orbit carries its own scale", () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const ring = satelliteRing(count);
      expect(ring).toHaveLength(count);
      const gaps = ring.slice(1).map((angle, i) => angle - (ring[i] ?? 0));
      for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / SATELLITE_SLOTS, 10);
    }
    expect(satelliteRing(1)).toEqual(satelliteRing(6).slice(0, 1));
  });

  it("stops at the cap rather than lapping the orbit", () => {
    expect(satelliteRing(40)).toHaveLength(SATELLITE_SLOTS);
    expect(satelliteRing(SATELLITE_SLOTS)).toEqual(satelliteRing(SATELLITE_SLOTS + 1));
  });
});
