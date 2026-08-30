/**
 * Where a specimen sits across the volume, as opposed to along it.
 *
 * Depth is time and stays a measurement: `slotZ(index)` puts the newest run
 * nearest the open face and every other run behind it in order. What this adds
 * is the other two axes, and they are **not** measurements — they are a
 * deterministic function of the run's id and mean nothing at all.
 *
 * That is a narrowing of decision 68, written down in decision 70. The record
 * used to be a line of specimens at one x and one y, which is honest and reads
 * as a row of pins in a case. Scattering it makes the chamber a volume with
 * something in it rather than a corridor with a rail down the middle. Nothing
 * about a run can be read off its height or its lateral position, and nothing
 * in the product ever asks a reader to.
 *
 * Deterministic and seeded off the id, so a run never moves. A field reshuffled
 * on every poll would be an animation of nothing, and a reader who found a
 * specimen once has to be able to find it again.
 *
 * Two things constrain it, and both are tested:
 *
 * - It stays inside the volume, at every depth.
 * - It stays out of the readout's way. The headline sits at the top left of the
 *   frame and the stats at the bottom left, so the field is weighted right and
 *   floored at `minX(z)` — and the floor rises toward the near face, because a
 *   near specimen is larger on screen and reaches further into the type.
 */

import { BACK_Z, CHAMBER_BOX, FRONT_Z, RECORD_X } from "./chamber-layout";
import { clamp01 } from "./ease";

export interface Offset {
  x: number;
  y: number;
}

/** How much of the volume's half-width and half-height the field may use. */
const SPREAD_X = 0.82;
const SPREAD_Y = 0.66;

/**
 * How much of that spread a run at the very front gets.
 *
 * The field is a cone, not a box, and the camera is why. It stands inside the
 * mouth of the chamber, so the near end of the record is close enough that the
 * frame there is barely two units across — a newest run scattered to the full
 * width would simply be off the side of the screen, which is not a scatter but
 * a run nobody can see. Spread grows with distance, so the far end fills the
 * volume and the near end stays in shot.
 */
const NEAR_SPREAD = 0.22;

/**
 * How hard the field leans right, as an exponent on a uniform.
 *
 * Below 1 pushes mass toward the far end of the range. At 0.55 roughly two
 * thirds of the record sits right of centre, which clears the type without the
 * left half of the volume being visibly empty — a hard split would read as two
 * panels rather than as one room.
 */
const RIGHT_BIAS = 0.72;

/** Half the volume, which every spread below is a fraction of. */
const HALF_W = CHAMBER_BOX.width / 2;
const HALF_H = CHAMBER_BOX.height / 2;

/** The far and near limits of the clear region, as offsets from `RECORD_X`. */
const CLEAR_AT_BACK = -HALF_W * SPREAD_X;
const CLEAR_AT_FRONT = -HALF_W * 0.12;

/** 0 at the open face, 1 at the back wall. */
function depthFraction(z: number): number {
  return clamp01((FRONT_Z - z) / (FRONT_Z - BACK_Z));
}

/** How much of the field's full width a run at this depth may use. */
function spreadAt(z: number): number {
  return NEAR_SPREAD + (1 - NEAR_SPREAD) * depthFraction(z);
}

/**
 * The leftmost x a specimen at this depth may take.
 *
 * A straight ramp from the back of the volume to the open face. At the back a
 * specimen is small, far from the reader's eye and behind the fog, so it may
 * cross under the headline; at the front it is the largest thing on screen and
 * has to stay clear of it.
 */
export function minX(z: number): number {
  const t = 1 - depthFraction(z);
  return RECORD_X + CLEAR_AT_BACK + (CLEAR_AT_FRONT - CLEAR_AT_BACK) * t;
}

/** The widest and highest a specimen may sit — at the back, where it is widest. */
export const FIELD = {
  minX: RECORD_X - HALF_W * SPREAD_X,
  maxX: RECORD_X + HALF_W * SPREAD_X,
  minY: -HALF_H * SPREAD_Y,
  maxY: HALF_H * SPREAD_Y,
} as const;

/**
 * FNV-1a over the id, which is all this needs to be: a stable, well-mixed
 * number per run. Two draws from one hash rather than two hashes, so a run id
 * that differs in one character moves in both axes at once.
 */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The low and high halves of the hash, each as a uniform in [0, 1). */
function draws(id: string): [number, number] {
  const h = hash(id);
  const a = (h & 0xffff) / 0x10000;
  const b = ((h >>> 16) & 0xffff) / 0x10000;
  return [a, b];
}

/**
 * Where the run with this id sits at this depth.
 *
 * `z` is an input rather than something to be derived here: the caller has it
 * from `slotZ`, and passing it keeps this function's whole contract — a point
 * inside the field and right of `minX(z)` — checkable without a scene.
 */
export function scatterAt(runId: string, z: number): Offset {
  const [a, b] = draws(runId);
  const spread = spreadAt(z);
  // Biased right. `a ** RIGHT_BIAS` skews a uniform toward 1, so the left of
  // the field is reachable but sparse — the type is over there, and a hard
  // split would read as two panels rather than as one room.
  const across = a ** RIGHT_BIAS * 2 - 1;
  const up = b * 2 - 1;
  const x = Math.max(RECORD_X + across * HALF_W * SPREAD_X * spread, minX(z));
  const y = up * HALF_H * SPREAD_Y * spread;
  return { x, y };
}
