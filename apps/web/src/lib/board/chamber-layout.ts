/**
 * The chamber's dimensions, in scene units.
 *
 * These lived inside `scene.ts` as module constants, which was fine while one
 * file drew the whole room. It is split now — the gates, the specimens, the
 * atmosphere and the camera are separate modules, and a second scene on the
 * run page builds specimens with no room at all — so the numbers live here,
 * where every one of them reads the same source and a change cannot half-land.
 *
 * Pure, and so tested where there is a claim to test.
 */

/**
 * The record is three layers deep, and a layer is a group of runs by recency
 * (decision 80). Depth is time and nothing else; three is what a reader can
 * count at a glance, and what a full-height frame can hold with the front
 * layer large and the back one still an object rather than a dot.
 */
export const LAYER_COUNT = 3;
/** Distance from one layer to the next, front to back. */
export const LAYER_SPACING = 2.6;
/**
 * Where the newest layer sits. Behind the camera's own station: the near end
 * is the closest thing on screen, and at two units a star fills a third of the
 * frame with its neighbours already behind the viewer.
 */
export const FRONT_Z = 0.2;

/** Where a layer sits on the time axis. Layer 0 is the newest, nearest. */
export function layerZ(layer: number): number {
  return FRONT_Z - Math.min(Math.max(0, layer), LAYER_COUNT - 1) * LAYER_SPACING;
}

/** The oldest layer's depth, and the far end of anything that has a far end. */
export const BACK_Z = layerZ(LAYER_COUNT - 1);

/**
 * The record sits right of centre, and the camera stands left of it looking
 * across. A field placed on the camera's own axis converges straight onto the
 * vanishing point and every layer piles into one knot; offset, it recedes
 * diagonally and every layer keeps its own piece of the frame. The offset is
 * also what leaves the left of the viewport clear for the headline.
 */
export const RECORD_X = 1.15;

/**
 * The widest ring a check draws, at `length: 1`, and the narrowest, at the
 * shortest length the shape admits. A ring is a radius and not a reach, so the
 * floor is higher than an arm's was: a ring smaller than about a third of the
 * widest one is a circle round the core rather than an orbit.
 */
export const RING_MAX = 0.3;
export const RING_MIN = RING_MAX * 0.29;
/** The bright arc's tube. The faint arc is drawn thinner from this. */
export const RING_TUBE = 0.007;

/** Below this many runs the camera comes in, so one run is not a distant dot. */
export const SPARSE_BELOW = 4;

/**
 * How sparse the record is, 0 to 1.
 *
 * A record of one or two runs in a volume built for thirty is a dot at the
 * end of an empty room, so the camera comes in and frames what is actually
 * there. 1 on an empty board, 0 once there are `SPARSE_BELOW` runs.
 */
export function sparseness(count: number): number {
  if (count <= 0) return 1;
  return Math.max(0, (SPARSE_BELOW - count) / (SPARSE_BELOW - 1));
}
