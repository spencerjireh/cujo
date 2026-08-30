/**
 * The decorative layer's arithmetic (decision 69).
 *
 * Everything here describes air: where dust sits, how it drifts, how bright the
 * haze is near the sweep, and how the backdrop is graded. None of it reads a
 * run, and nothing that reads a run is allowed in here — that separation is the
 * whole of what decision 69 permits, and it is checkable precisely because this
 * module imports no run type at all.
 *
 * Pure, and tested for the two properties that matter: at rest it is exactly
 * its seeded state, so reduced motion draws one honest frame; and the dust
 * never leaves the volume, so no particle is ever seen outside the box it is
 * meant to be inside.
 */

export interface FieldBox {
  width: number;
  height: number;
  depth: number;
  /** Centre of the box on each axis. */
  x: number;
  y: number;
  z: number;
}

/**
 * A small deterministic generator.
 *
 * `Math.random` would reseed the dust on every mount, which is a different
 * field after every client navigation and, worse, a different single frame
 * every time reduced motion renders one. Mulberry32 is four lines and makes the
 * field a function of its seed.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Positions for `count` motes, filling the box. Deterministic per seed. */
export function dustPositions(count: number, box: FieldBox, seed = 1): Float32Array {
  const out = new Float32Array(Math.max(0, count) * 3);
  const random = rng(seed);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = box.x + (random() - 0.5) * box.width;
    out[i + 1] = box.y + (random() - 0.5) * box.height;
    out[i + 2] = box.z + (random() - 0.5) * box.depth;
  }
  return out;
}

/** How far a mote wanders from where it was seeded. Small: this is air, not weather. */
const DRIFT = { x: 0.06, y: 0.09, z: 0.04 } as const;
const DRIFT_SECONDS = { x: 17, y: 11, z: 23 } as const;

/**
 * Move the dust, writing into `out`.
 *
 * Each mote orbits its own seeded position on three periods that do not divide
 * each other, so the field never repeats a pose and no mote ever leaves the
 * neighbourhood it was seeded in. Phase comes from the seeded position itself
 * rather than from an index, so two motes that happen to sit near each other
 * still drift apart.
 *
 * At `elapsed === 0` every offset is zero on x and z and the y term is written
 * from its own cosine at phase 0 — so the guarantee the test pins is stated
 * against `base` rather than assumed: reduced motion renders the seeded field.
 */
export function driftDust(
  out: Float32Array,
  base: Float32Array,
  elapsed: number,
  box: FieldBox,
): void {
  for (let i = 0; i < base.length; i += 3) {
    const bx = base[i] ?? 0;
    const by = base[i + 1] ?? 0;
    const bz = base[i + 2] ?? 0;
    const phase = bx * 3.1 + by * 5.7 + bz * 1.3;
    out[i] = clampAxis(
      bx +
        Math.sin(phase + (elapsed / DRIFT_SECONDS.x) * Math.PI * 2) * DRIFT.x -
        Math.sin(phase) * DRIFT.x,
      box.x,
      box.width,
    );
    out[i + 1] = clampAxis(
      by +
        Math.sin(phase + (elapsed / DRIFT_SECONDS.y) * Math.PI * 2) * DRIFT.y -
        Math.sin(phase) * DRIFT.y,
      box.y,
      box.height,
    );
    out[i + 2] = clampAxis(
      bz +
        Math.sin(phase + (elapsed / DRIFT_SECONDS.z) * Math.PI * 2) * DRIFT.z -
        Math.sin(phase) * DRIFT.z,
      box.z,
      box.depth,
    );
  }
}

function clampAxis(value: number, centre: number, extent: number): number {
  const half = extent / 2;
  return Math.min(centre + half, Math.max(centre - half, value));
}

/**
 * How bright a haze shaft is, given where the sweep plane is.
 *
 * The haze is what the sweep moves *through*: brightest where the plane is,
 * falling off over `reach`, and never dark — a room with no air in it when the
 * board is quiet is the state this layer exists to fix. The base is what it
 * carries with no sweep running at all.
 */
export function hazeStrength(shaftZ: number, planeZ: number | null, reach: number): number {
  const base = 0.35;
  if (planeZ === null || reach <= 0) return base;
  const near = Math.max(0, 1 - Math.abs(shaftZ - planeZ) / reach);
  return base + (1 - base) * near;
}

/**
 * How far a backdrop plane must span to fill the frame at a distance.
 *
 * The backdrop is parented to the camera, so it moves with the eye and is
 * always exactly behind everything. That only works if it covers the frustum at
 * the distance it sits, which is what this returns.
 */
export function backdropExtent(
  fovDeg: number,
  aspect: number,
  distance: number,
): { width: number; height: number } {
  const fov = (Math.min(Math.max(fovDeg, 1), 179) * Math.PI) / 180;
  const height = 2 * Math.tan(fov / 2) * distance;
  return { width: height * Math.max(aspect, 0.01), height };
}

/**
 * The backdrop's grade at a point, 1 at the focus and 0 at the far corner.
 *
 * A flat clear colour gives the volume no sky and no floor, so the fog has
 * nothing to resolve into and the box reads as a rectangle cut out of the page.
 * A grade is the cheapest depth there is: it costs one plane and no pass.
 */
export function gradeWeight(
  u: number,
  v: number,
  focusU: number,
  focusV: number,
  falloff: number,
): number {
  const distance = Math.hypot(u - focusU, v - focusV);
  const spread = Math.max(falloff, 0.0001);
  return Math.min(1, Math.max(0, 1 - distance / spread));
}
