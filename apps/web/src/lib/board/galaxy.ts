/**
 * Where a run sits in the galaxy.
 *
 * Depth is time and stays a measurement: the record is three layers by recency
 * (decision 71), and `layerOf` says which one a run is in. What this adds is
 * the position *within* a layer, and that is **not** a measurement — it is a
 * deterministic function of the run's slot and id and means nothing at all,
 * which decision 70 already said of the old field and the legend still says in
 * words.
 *
 * Each layer is a band: an ellipse, wider than tall, with its slots spread
 * round it at equal angles and each run jittered off its slot by its id. The
 * jitter is bounded so two runs in one layer can never collide, and the band's
 * left edge is held clear of the readout, which sits at the left of the frame
 * — nearer bands are held further right because a near star is the largest
 * thing on screen and reaches furthest into the type. Both are tested rather
 * than eyeballed.
 *
 * Deterministic and seeded off the id, so a run never moves within its layer.
 * It does move *between* layers as newer runs arrive, which is the record
 * advancing, and the scene slides it.
 */

import { LAYER_COUNT, RECORD_X, layerZ } from "./chamber-layout";
import { uniforms } from "./hash";
import type { Vec3 } from "./orbit";

/**
 * How many runs each layer holds, newest first: six large stars in front and
 * the rest denser behind, which is the near-to-far gradient a galaxy has and
 * a corridor of equal slots does not.
 */
export const LAYER_CAPACITY: readonly number[] = [6, 10, 14];

/** How many runs the chamber draws. The record below still lists them all. */
export const CAPACITY = LAYER_CAPACITY.reduce((sum, n) => sum + n, 0);

/**
 * Each band's centre and horizontal radius, front to back.
 *
 * The centre drifts right toward the front and the radius grows toward the
 * back, so that a band's left edge — centre minus its widest jittered radius —
 * lands exactly on `minX` for that layer. Stated as two lists rather than a
 * formula so a reader can see the five numbers the frame was composed with.
 */
const BAND_CENTRE_X: readonly number[] = [2.4, 2.65, 2.75];
const BAND_RADIUS: readonly number[] = [0.9, 1.7, 2.4];
/** Bands are discs seen from above the plane: wider than tall. */
export const BAND_FLATTEN = 0.66;

/** How far a run may jitter off its slot: in angle, and as a radius factor. */
const JITTER_ANGLE = (3 * Math.PI) / 180;
const JITTER_RADIUS = 0.1;
/** The widest a jittered radius can be, as a factor. What the band's edge uses. */
export const BAND_REACH = 1 + JITTER_RADIUS;

/**
 * A fixed turn per layer, so the slots of one band never line up with the
 * next in perspective and read as spokes.
 */
function layerTurn(layer: number): number {
  return layer * 0.9 + 0.3;
}

export interface Band {
  layer: number;
  z: number;
  /** Centre. Every band sits on the record's own height. */
  x: number;
  /** Outer extent, jitter included, which is what a gate is drawn at. */
  rx: number;
  ry: number;
}

/** The band a layer occupies. Clamped to the last layer past the end. */
export function bandOf(layer: number): Band {
  const k = Math.min(Math.max(0, Math.trunc(layer)), LAYER_COUNT - 1);
  const radius = (BAND_RADIUS[k] ?? 0) * BAND_REACH;
  return {
    layer: k,
    z: layerZ(k),
    x: BAND_CENTRE_X[k] ?? RECORD_X,
    rx: radius,
    ry: radius * BAND_FLATTEN,
  };
}

/**
 * The leftmost x a run in this layer may take: the band's own left edge. A
 * straight ramp from the front, where a star is large and clear of the type,
 * to the back, where it is small, fogged, and may sit under the headline.
 */
export function minX(layer: number): number {
  const band = bandOf(layer);
  return band.x - band.rx;
}

export interface Place {
  layer: number;
  slot: number;
}

/** Which layer a run at this index is in, and which slot of it. */
export function layerOf(index: number): Place {
  let start = 0;
  for (let layer = 0; layer < LAYER_CAPACITY.length; layer += 1) {
    const capacity = LAYER_CAPACITY[layer] ?? 0;
    if (index < start + capacity) return { layer, slot: index - start };
    start += capacity;
  }
  // Past the capacity, which the chamber never draws: the last layer, in a
  // slot it will share. Stated rather than thrown so a caller that trims late
  // still gets a place.
  const last = LAYER_CAPACITY.length - 1;
  return { layer: last, slot: (index - start) % (LAYER_CAPACITY[last] ?? 1) };
}

/** Two draws from the id, each as a uniform in [-1, 1). One hash, not two. */
function draws(id: string): [number, number] {
  const [a = 0, b = 0] = uniforms(id, 2);
  return [a * 2 - 1, b * 2 - 1];
}

/**
 * Where the run with this id sits, in this layer and slot.
 *
 * The slot fixes the angle round the band and the id jitters it, in angle and
 * in radius, by less than half the gap to the next slot — so two runs in one
 * layer keep their distance whatever their ids, and the band's edge is where
 * the jitter runs out.
 */
export function placeIn(layer: number, slot: number, id: string): Vec3 {
  const band = bandOf(layer);
  const capacity = LAYER_CAPACITY[band.layer] ?? 1;
  const [a, b] = draws(id);
  const angle = (slot / capacity) * 2 * Math.PI + layerTurn(band.layer) + a * JITTER_ANGLE;
  const radius = (BAND_RADIUS[band.layer] ?? 0) * (1 + b * JITTER_RADIUS);
  const x = band.x + Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius * BAND_FLATTEN;
  return { x: Math.max(x, minX(band.layer)), y, z: band.z };
}

/** Where a run at this index of the record sits. */
export function placeAt(index: number, id: string): Vec3 {
  const { layer, slot } = layerOf(index);
  return placeIn(layer, slot, id);
}
