import { CHECK_NAMES } from "@/lib/api/types";
import {
  AZIMUTH_JITTER,
  RING_NORMALS,
  SATELLITE_SLOTS,
  TILT_MAX_Z,
  TILT_MIN_Z,
  projectRing,
  ringBasis,
  ringNormals,
  ringPoint,
  satelliteRing,
} from "@/lib/board/orbit";
import { describe, expect, it } from "vitest";

/**
 * A run's orbits. Three claims worth pinning, all of the sort that read as
 * obvious and are not:
 *
 * 1. A run's four ring planes come from its id alone, and are never edge-on,
 *    flat, or close to each other.
 * 2. A flat drawing given a run's normals projects that run's own planes —
 *    which is what lets the run page's glyph stay the same drawing as the
 *    object in the chamber.
 * 3. The bright arc and the faint arc make one closed ring between them.
 */

const IDS = ["run-1", "run-2", "a", "0f3c9e", "owner/repo#42:abc", "z".repeat(40)];
const azimuthOf = (n: { x: number; y: number }) => Math.atan2(n.y, n.x);
const turnBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

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
});

describe("ringNormals", () => {
  it("has one ring per check, in the order the checks are named", () => {
    for (const id of IDS) expect(ringNormals(id)).toHaveLength(CHECK_NAMES.length);
  });

  it("is a function of the id alone", () => {
    for (const id of IDS) expect(ringNormals(id)).toEqual(ringNormals(id));
    expect(ringNormals("run-1")).not.toEqual(ringNormals("run-2"));
  });

  it("is unit length, so a ring's radius is its measurement and nothing else", () => {
    for (const id of IDS) {
      for (const n of ringNormals(id)) expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10);
    }
  });

  it("never lies flat to the reader and is never edge-on", () => {
    // A ring with its normal on the view axis is a circle; one with its normal
    // across it is a line. Neither is a ring with a tilt to show.
    for (const id of IDS) {
      for (const n of ringNormals(id)) {
        expect(Math.abs(n.z)).toBeGreaterThanOrEqual(TILT_MIN_Z);
        expect(Math.abs(n.z)).toBeLessThanOrEqual(TILT_MAX_Z);
      }
    }
  });

  it("keeps the four planes of one run apart in azimuth", () => {
    // A quarter turn apart, each jittered by less than half of that, so the
    // nearest two planes are still further apart than the jitter allows.
    const floor = Math.PI / 2 - 2 * AZIMUTH_JITTER;
    for (const id of IDS) {
      const normals = ringNormals(id);
      for (let i = 0; i < normals.length; i += 1) {
        for (let j = i + 1; j < normals.length; j += 1) {
          const a = normals[i];
          const b = normals[j];
          if (!a || !b) throw new Error("unreachable");
          expect(turnBetween(azimuthOf(a), azimuthOf(b))).toBeGreaterThanOrEqual(floor - 1e-9);
        }
      }
    }
  });

  it("leans alternate rings away from the reader", () => {
    for (const id of IDS) {
      const [a, b, c, d] = ringNormals(id);
      if (!a || !b || !c || !d) throw new Error("unreachable");
      expect(Math.sign(a.z)).toBe(1);
      expect(Math.sign(b.z)).toBe(-1);
      expect(Math.sign(c.z)).toBe(1);
      expect(Math.sign(d.z)).toBe(-1);
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

  it("projects the normals it is given, and the tetrahedral set otherwise", () => {
    // The squash of a projected ring is `|n.z|`, so a drawing handed a run's
    // own normals shows that run's own tilts and not the fallback's.
    const normals = ringNormals("run-1");
    for (let i = 0; i < normals.length; i += 1) {
      const n = normals[i];
      if (!n) throw new Error("unreachable");
      const radii = projectRing(i, 1, null, 720, normals).bright.map((p) => Math.hypot(p.x, p.y));
      expect(Math.max(...radii)).toBeCloseTo(1, 3);
      expect(Math.min(...radii)).toBeCloseTo(Math.abs(n.z), 3);
    }
    const fallback = projectRing(0, 1, null, 720).bright.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...fallback)).toBeCloseTo(1 / Math.sqrt(3), 3);
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
