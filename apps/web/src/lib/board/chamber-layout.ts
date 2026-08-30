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
 * Depth is the axis the record runs along; width and height are the field the
 * record is scattered across (decision 70). It was a 3.9 x 2.3 x 17 corridor
 * while the record was one line of specimens down the middle of it — long
 * enough for twenty-four runs and too low to fill a full-height frame. Ten
 * larger specimens spread through a shorter, wider, taller room read as a
 * volume with something in it.
 */
export const CHAMBER_BOX = { width: 7.2, height: 4.2, depth: 13 } as const;

/**
 * The record sits right of centre, and the camera stands left of it looking
 * across. A row placed on the camera's own axis converges straight onto the
 * vanishing point and the whole history piles into one knot; offset, it recedes
 * diagonally and every specimen keeps its own piece of the frame. The offset is
 * also what leaves the left of the viewport clear for the headline.
 */
export const RECORD_X = 1.15;
/** The record's own height, which the scatter offsets from. */
export const RECORD_Y = 0.1;
/** Distance between one run and the next, front to back. */
export const SPACING = 0.95;
/**
 * Where the newest run sits.
 *
 * Behind the camera's own station rather than level with the mouth: standing
 * inside the volume means the near end is the closest thing on screen, and at
 * two units it was a single specimen filling a third of the frame with its
 * neighbours already behind the viewer.
 */
export const FRONT_Z = 0.2;
/**
 * Longest arm a specimen draws, at `length: 1`. Sized against `SPACING`: an arm
 * longer than about half the gap and the near specimens overlap into a thicket
 * instead of reading as a series.
 */
export const ARM_MAX = 0.5;
export const ARM_THICKNESS = 0.02;

export const FLOOR_Y = -CHAMBER_BOX.height / 2;
export const CEILING_Y = CHAMBER_BOX.height / 2;

/**
 * Where the volume's near face is.
 *
 * Ahead of the camera, which is the whole point: the camera stands inside the
 * mouth of the chamber, so the near edges of the box run off the top and sides
 * of the frame toward the vanishing point instead of sitting in it as a
 * rectangle. Stated directly rather than derived from `FRONT_Z` — it used to
 * be `FRONT_Z - depth/2 + 0.6`, which put the face behind the newest specimen
 * and made "how far in front of the camera does the record start" a number
 * nobody could name.
 */
export const MOUTH_Z = 4.5;
/** The wireframe box's centre, and the far wall behind the fog. */
export const SHELL_Z = MOUTH_Z - CHAMBER_BOX.depth / 2;
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
