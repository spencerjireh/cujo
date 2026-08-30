/**
 * A run's orbits: where its four rings lie, how one is drawn flat, and where
 * its satellites sit. The shape's own geometry, with no renderer in it.
 *
 * A run is a star system (decision 71). The core is the star and the verdict;
 * each check is a ring around it, its radius how long the check watched, the
 * bright arc of it the share spent executing in the sandbox, its colour how
 * the check ended; findings are satellites on an orbit outside the rings.
 *
 * The four ring planes are the four tetrahedral directions the arms used to
 * leave the core along, now used as normals. Every pair is 109.47° apart, the
 * widest four planes can be from each other, and — the property that matters
 * for the flat drawings — each projects down the view axis to an ellipse with
 * the same minor/major ratio, `1/sqrt(3)`, squashed along one of the four 45°
 * diagonals. So `tests` still sits upper-left and `detonation` lower-left in
 * the run page's glyph, and the four rings are always distinguishable by their
 * orientation alone. One fixed orientation for every run, never turned to face
 * the camera: a ring's tilt *is* its check, and two runs are comparable by
 * silhouette only while that holds.
 *
 * Pure and DOM-free, like every other module here, because
 * `components/board/chamber/` cannot be tested at all — `apps/web` runs vitest
 * in node with no DOM.
 */

import { CHECK_NAMES, type CheckName } from "@/lib/api/types";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/** The four cube diagonals, normalised. `1/sqrt(3)` on every component. */
const D = 1 / Math.sqrt(3);

/**
 * One ring normal per check, in `CHECK_NAMES` order — `tests`, `probes`,
 * `smoke`, `detonation`.
 *
 * The signs put each ring's projected minor axis on the diagonal the check's
 * arm used to lie along, so the quadrant a reader learned still belongs to the
 * same check.
 */
export const RING_NORMALS: readonly Vec3[] = [
  { x: -D, y: D, z: D },
  { x: D, y: D, z: -D },
  { x: D, y: -D, z: D },
  { x: -D, y: -D, z: -D },
];

/** Minor over major of every projected ring: `|n.z|`, the same for all four. */
export const PROJECTED_SQUASH = D;

/** How many satellites a run draws before it stops being countable. */
export const SATELLITE_SLOTS = 6;

/**
 * Where the satellites orbit, as a multiple of `RING_MAX`. Outside the widest
 * ring a check can draw, so a finding never sits on a check.
 */
export const SATELLITE_ORBIT = 1.12;

/** Segments per full ring, for the flat drawings. */
export const RING_STEPS = 64;

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export interface RingBasis {
  /** Where the ring's angle zero is: the point the bright arc starts from. */
  u: Vec3;
  /** A quarter turn on from it, in the ring's own plane. */
  v: Vec3;
}

/**
 * Two in-plane directions for a ring, fixed by its normal alone.
 *
 * `u` is the normal crossed with world up, so it lies flat; the bright arc
 * starts there on every ring of every run, which is what makes two runs'
 * execution shares comparable by eye.
 */
export function ringBasis(normal: Vec3): RingBasis {
  const n = normalize(normal);
  const u = normalize(cross({ x: 0, y: 1, z: 0 }, n));
  const v = cross(n, u);
  return { u, v };
}

/** A point on the ring with this normal, at this radius and angle. */
export function ringPoint(normal: Vec3, radius: number, angle: number): Vec3 {
  const { u, v } = ringBasis(normal);
  const c = Math.cos(angle) * radius;
  const s = Math.sin(angle) * radius;
  return { x: u.x * c + v.x * s, y: u.y * c + v.y * s, z: u.z * c + v.z * s };
}

export interface ProjectedRing {
  name: CheckName;
  /** The share spent executing, as a polyline. Screen y, positive **down**. */
  bright: Point2[];
  /** What was left, continuing the arc to close the ring. Empty for a whole ring. */
  faint: Point2[];
}

/**
 * One ring as a flat drawing would draw it.
 *
 * `share` is 0–1 of the ring that is bright, or null for a ring drawn whole —
 * a check that measured no share is not one that measured none. The two arcs
 * share their meeting point, so drawn end to end they close without a gap.
 *
 * `y` is flipped here and only here: the scene's y runs up and SVG's runs
 * down, and putting the flip in the projection means no caller has to
 * remember it.
 */
export function projectRing(
  index: number,
  radius: number,
  share: number | null,
  steps = RING_STEPS,
): ProjectedRing {
  const normal = RING_NORMALS[index];
  const name = CHECK_NAMES[index];
  if (!normal || !name) throw new RangeError(`no ring at index ${index}`);
  const lit = share === null ? 1 : Math.min(1, Math.max(0, share));
  const total = Math.max(2, Math.trunc(steps));
  const at = (angle: number): Point2 => {
    const p = ringPoint(normal, radius, angle);
    return { x: p.x, y: -p.y };
  };
  const brightSteps = Math.max(1, Math.round(total * lit));
  const bright: Point2[] = [];
  for (let i = 0; i <= brightSteps; i += 1) {
    bright.push(at((i / brightSteps) * lit * 2 * Math.PI));
  }
  const faint: Point2[] = [];
  if (lit < 1) {
    const faintSteps = Math.max(1, total - brightSteps);
    for (let i = 0; i <= faintSteps; i += 1) {
      faint.push(at((lit + (i / faintSteps) * (1 - lit)) * 2 * Math.PI));
    }
  }
  return { name, bright, faint };
}

/**
 * Where the satellites sit around the core, as angles in radians, in the
 * plane facing the reader.
 *
 * Six fixed slots, filled in order, rather than `count` spread evenly over the
 * circle: fixed slots make the cap visible — a run with one finding occupies a
 * sixth of the orbit and a run with six fills it — so the drawing carries its
 * own scale instead of looking identical at every count. The offset keeps the
 * first slot off the diagonals, where the rings are at their widest.
 */
const SLOT_OFFSET = Math.PI / 6;

export function satelliteRing(count: number): number[] {
  const slots = Math.min(Math.max(0, Math.trunc(count)), SATELLITE_SLOTS);
  return Array.from({ length: slots }, (_, i) => SLOT_OFFSET + (i * 2 * Math.PI) / SATELLITE_SLOTS);
}
