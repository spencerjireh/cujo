import {
  type FieldBox,
  backdropExtent,
  driftDust,
  dustPositions,
  gradeWeight,
  hazeStrength,
} from "@/lib/board/atmosphere-field";
import { describe, expect, it } from "vitest";

const BOX: FieldBox = { width: 4, height: 2.4, depth: 17, x: 1.15, y: 0, z: -6 };

function inside(positions: Float32Array, box: FieldBox): boolean {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (Math.abs(x - box.x) > box.width / 2 + 1e-6) return false;
    if (Math.abs(y - box.y) > box.height / 2 + 1e-6) return false;
    if (Math.abs(z - box.z) > box.depth / 2 + 1e-6) return false;
  }
  return true;
}

describe("dustPositions", () => {
  it("fills the box and stays in it", () => {
    const positions = dustPositions(200, BOX);
    expect(positions).toHaveLength(600);
    expect(inside(positions, BOX)).toBe(true);
  });

  /**
   * Math.random would reseed on every mount: a different field after every
   * client navigation, and a different single frame every time reduced motion
   * draws one.
   */
  it("is the same field for the same seed", () => {
    expect(Array.from(dustPositions(20, BOX, 7))).toEqual(Array.from(dustPositions(20, BOX, 7)));
  });

  it("is a different field for a different seed", () => {
    expect(Array.from(dustPositions(20, BOX, 7))).not.toEqual(
      Array.from(dustPositions(20, BOX, 8)),
    );
  });

  it("draws nothing when asked for nothing", () => {
    expect(dustPositions(0, BOX)).toHaveLength(0);
    expect(dustPositions(-5, BOX)).toHaveLength(0);
  });
});

describe("driftDust", () => {
  /** The reduced-motion guarantee, stated rather than assumed. */
  it("is exactly the seeded field at rest", () => {
    const base = dustPositions(60, BOX, 3);
    const out = new Float32Array(base.length);
    driftDust(out, base, 0, BOX);
    for (let i = 0; i < base.length; i += 1) {
      expect(out[i]).toBeCloseTo(base[i] ?? 0, 6);
    }
  });

  it("moves the field once time passes", () => {
    const base = dustPositions(60, BOX, 3);
    const out = new Float32Array(base.length);
    driftDust(out, base, 4, BOX);
    expect(Array.from(out)).not.toEqual(Array.from(base));
  });

  it("never lets a mote leave the volume, at any moment", () => {
    const base = dustPositions(120, BOX, 5);
    const out = new Float32Array(base.length);
    for (let t = 0; t < 300; t += 7.3) {
      driftDust(out, base, t, BOX);
      expect(inside(out, BOX)).toBe(true);
    }
  });
});

describe("hazeStrength", () => {
  it("carries a base brightness with no sweep running", () => {
    // A room with no air in it when the board is quiet is the state this layer
    // exists to fix.
    expect(hazeStrength(-3, null, 4)).toBeGreaterThan(0);
  });

  it("is brightest where the plane is", () => {
    expect(hazeStrength(-3, -3, 4)).toBe(1);
  });

  it("falls off with distance from the plane, never below the base", () => {
    const near = hazeStrength(-3, -2, 4);
    const far = hazeStrength(-3, 6, 4);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
});

describe("backdropExtent", () => {
  it("covers the frustum at the distance it sits", () => {
    const { width, height } = backdropExtent(30, 16 / 9, 10);
    expect(height).toBeCloseTo(2 * Math.tan((30 * Math.PI) / 180 / 2) * 10, 6);
    expect(width / height).toBeCloseTo(16 / 9, 6);
  });

  it("grows with distance and with field of view", () => {
    expect(backdropExtent(30, 1, 20).height).toBeGreaterThan(backdropExtent(30, 1, 10).height);
    expect(backdropExtent(60, 1, 10).height).toBeGreaterThan(backdropExtent(30, 1, 10).height);
  });
});

describe("gradeWeight", () => {
  it("is full at the focus and gone at the far corner", () => {
    expect(gradeWeight(0.5, 0.4, 0.5, 0.4, 0.9)).toBe(1);
    expect(gradeWeight(0, 1, 0.5, 0.4, 0.3)).toBe(0);
  });

  it("never leaves 0 to 1", () => {
    for (let u = 0; u <= 1; u += 0.1) {
      for (let v = 0; v <= 1; v += 0.1) {
        const weight = gradeWeight(u, v, 0.5, 0.45, 0.8);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
