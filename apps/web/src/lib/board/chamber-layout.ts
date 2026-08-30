/**
 * The chamber's dimensions, in scene units.
 *
 * These lived inside `scene.ts` as module constants, which was fine while one
 * file drew the whole room. It is split now — the room, the specimens, the
 * atmosphere and the camera are separate modules, and a second scene on the run
 * page builds specimens with no room at all — so the numbers move here, where
 * every one of them reads the same source and a change cannot half-land.
 *
 * Pure, and so tested: the two rules with a claim in them, the chain's length
 * and the sparse dolly, are exactly the sort that read as obvious and are not.
 */

/**
 * Depth is the axis the record runs along, and it is long: the recession from
 * the near face to the fog is the only thing that makes twenty-four runs read
 * as a series rather than a stack.
 */
export const CHAMBER_BOX = { width: 3.9, height: 2.3, depth: 17 } as const;

/**
 * The record sits right of centre, and the camera stands left of it looking
 * across. A row placed on the camera's own axis converges straight onto the
 * vanishing point and the whole history piles into one knot; offset, it recedes
 * diagonally and every specimen keeps its own piece of the frame. The offset is
 * also what leaves the left of the viewport clear for the headline.
 */
export const RECORD_X = 1.15;
/** Height of the record inside the volume: the specimens hang, so above centre. */
export const RECORD_Y = 0.1;
/** Distance between one run and the next, front to back. */
export const SPACING = 0.58;
/** How far the front-most specimen sits from the open face. */
export const FRONT_Z = 1.0;
/**
 * Longest arm a specimen draws, at `length: 1`. Sized against `SPACING`: an arm
 * longer than about half the gap and the near specimens overlap into a thicket
 * instead of reading as a series.
 */
export const ARM_MAX = 0.3;
export const ARM_THICKNESS = 0.02;

export const FLOOR_Y = -CHAMBER_BOX.height / 2;
export const CEILING_Y = CHAMBER_BOX.height / 2;
/** Where the chain runs: below the ceiling, so the specimens hang from it. */
export const CHAIN_Y = CHAMBER_BOX.height / 2 - 0.22;
/** The wireframe box's centre, and the far wall behind the fog. */
export const SHELL_Z = FRONT_Z - CHAMBER_BOX.depth / 2 + 0.6;
export const BACK_Z = SHELL_Z - CHAMBER_BOX.depth / 2;

/** Below this many runs the camera comes in, so one run is not a distant dot. */
export const SPARSE_BELOW = 5;

/** Where a slot sits on the time axis. Slot 0 is the newest run, nearest. */
export function slotZ(index: number): number {
  return FRONT_Z - index * SPACING;
}

/** Every slot the volume has room for. The ribs are drawn one per slot. */
export function slotCount(): number {
  return Math.max(1, Math.floor(CHAMBER_BOX.depth / SPACING));
}

/**
 * Where the chain ends.
 *
 * At the last run on it, so its length is the record's length and a three-run
 * board has a short chain rather than pretending otherwise (decision 68). The
 * exception is an empty board: there is no record to bound it, so it runs the
 * volume — an instrument holding nothing is a different picture from an
 * instrument that is absent.
 */
export function chainEndZ(count: number): number {
  return count > 0 ? slotZ(count - 1) - 0.35 : BACK_Z + 0.4;
}

/**
 * How sparse the record is, 0 to 1.
 *
 * A record of one or two runs in a volume built for twenty-four is a dot at the
 * end of an empty room, so the camera comes in and the volume frames what is
 * actually in it. 1 on an empty board, 0 once there are `SPARSE_BELOW` runs.
 */
export function sparseness(count: number): number {
  if (count <= 0) return 1;
  return Math.max(0, (SPARSE_BELOW - count) / (SPARSE_BELOW - 1));
}
