/**
 * Where a specimen's four arms point, and where its findings sit around the
 * core. The shape's own geometry, with no renderer in it.
 *
 * A specimen used to be four arms in the plane facing the camera. That is a
 * drawing of a run rather than an object: the camera drifts, the chamber
 * breathes, and nothing about the shape is ever revealed, because there is
 * nothing behind it. The arms now leave the core along the four diagonals of a
 * cube, which is the tetrahedral arrangement — every pair at 109.47°, the
 * widest four directions can be from each other in three dimensions.
 *
 * **And the flat drawing does not move.** Orthographically projected down `z`,
 * those four directions land on exactly the four 45° diagonals the specimen has
 * always been drawn with, each at `sqrt(2/3)` of its length. So the run page's
 * glyph and the legend's diagram keep the silhouette a reader already knows,
 * and the object in the chamber is the same object with its depth restored.
 *
 * One fixed orientation for every specimen, never turned to face the camera: an
 * arm's direction is `tests` or `detonation` and nothing else, and two runs are
 * comparable by silhouette only while that holds.
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

/** The four cube diagonals, normalised. `1/sqrt(3)` on every component. */
const D = 1 / Math.sqrt(3);

/**
 * One unit vector per check, in `CHECK_NAMES` order — `tests`, `probes`,
 * `smoke`, `detonation`.
 *
 * The signs are chosen so the projection below lands each check in the quadrant
 * it has always occupied: `tests` upper left, `probes` upper right, `smoke`
 * lower right, `detonation` lower left. That was the order in the scene's old
 * `DIRECTIONS` array, and keeping it is what makes this change invisible to
 * anybody reading a specimen rather than looking at one.
 */
export const ARM_DIRECTIONS: readonly Vec3[] = [
  { x: -D, y: D, z: D },
  { x: D, y: D, z: -D },
  { x: D, y: -D, z: D },
  { x: -D, y: -D, z: -D },
];

/**
 * How much of an arm's length survives the projection: `sqrt(2/3)`, the same
 * for all four, because they are symmetric about the view axis.
 *
 * Exported so a flat drawing can state that it is drawing the projection of a
 * solid rather than a shape of its own.
 */
export const PROJECTED_REACH = Math.sqrt(2 / 3);

export interface ProjectedArm {
  name: CheckName;
  /** Offset from the core, in the same units `reach` was given in. */
  x: number;
  /** Screen y, positive **down**, so an SVG can use it without negating. */
  y: number;
  /** The arm's depth after projection. Positive is toward the viewer. */
  depth: number;
}

/**
 * The four arms as a flat drawing would place them, at a given reach.
 *
 * `y` is flipped here and only here: the scene's y runs up and SVG's runs down,
 * and putting the flip in the projection means no caller has to remember it.
 */
export function projectArms(reach: number): ProjectedArm[] {
  return ARM_DIRECTIONS.map((direction, index) => ({
    // `CHECK_NAMES` and `ARM_DIRECTIONS` are the same length by construction —
    // the array above is written one per check — so this index is always a name.
    name: CHECK_NAMES[index] as CheckName,
    x: direction.x * reach,
    y: -direction.y * reach,
    depth: direction.z,
  }));
}

/**
 * How many finding marks a specimen draws before it stops being countable.
 *
 * Lives here, beside the ring it fills, and is read by `specimen.ts` as its
 * cap: the number of slots and the cap are the same fact, and two constants
 * would let a mark be produced with nowhere to sit.
 */
export const MARK_SLOTS = 6;

/**
 * Where the finding marks sit around the core, as angles in radians.
 *
 * A ring rather than the stack up a drop line they used to be. The drop line is
 * gone — a specimen hangs on nothing now, the chain threads it — and a stack of
 * cubes on a string read as a barcode at any distance anyway. Around the core
 * they read as a count, which is what they are.
 *
 * Six fixed slots, filled in order, rather than `count` marks spread evenly
 * over the circle. Two reasons, and the second is why the first is not enough:
 *
 * - Fixed slots make the cap visible. A run with six findings fills the ring
 *   and a run with one fills a sixth of it, so the drawing carries its own
 *   scale instead of looking identical at every count.
 * - Even spacing cannot clear the arms. At five marks the spacing is 72° and
 *   the arms sit 90° apart, so some offset always lands a mark within a few
 *   degrees of an arm — 4.5° at the best offset, which is a mark drawn on top
 *   of a check. These six clear every arm by 15° whatever the count.
 */
const SLOT_OFFSET = Math.PI / 6;

export function markRing(count: number): number[] {
  const slots = Math.min(Math.max(0, Math.trunc(count)), MARK_SLOTS);
  return Array.from({ length: slots }, (_, i) => SLOT_OFFSET + (i * 2 * Math.PI) / MARK_SLOTS);
}
