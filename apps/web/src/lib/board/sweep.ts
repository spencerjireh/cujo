/**
 * The sweep, which is the board re-reading the API (decision 68).
 *
 * It leaves the far end of the record when `GET /public/runs` returns and
 * reaches the near end as the next request is due, so its position is how far
 * the board is from reading the record again.
 *
 * It is a plane crossing the volume. Decision 69 narrowed a plane to a cursor
 * on the chain because the record was a scattered field and a plane lit every
 * run at one depth together; the record is five layers now (decision 71) and a
 * layer *is* one depth, so a plane lights one layer at a time, which is what
 * an instrument reading a record in five pages looks like. The chain is gone
 * with the field it threaded.
 *
 * The envelope is asymmetric, because the two directions are not the same
 * event: a layer the plane has not reached is anticipating, and one it has
 * passed has just been read and is settling. Sharp on the way in, slow on the
 * way out.
 *
 * Pure, so the sequence claim is a test rather than something to squint at.
 */

import { BACK_Z, FRONT_Z } from "./chamber-layout";
import { clamp01 } from "./ease";

/** How long one sweep takes, clamped from the list query's own poll interval. */
export const SWEEP_MIN_SECONDS = 4;
export const SWEEP_MAX_SECONDS = 22;

/**
 * How far ahead of the plane a layer starts responding, and how far behind it
 * goes on glowing, in scene units of depth.
 *
 * The pair of them is what makes the read sequential: the window where a
 * layer is more than half lit is `LEAD/2 + TRAIL/2` deep, and that has to be
 * shallower than `LAYER_SPACING` for two layers never to be strongly lit at
 * once. `SWEEP_SPAN` states that depth so the test can hold it against the
 * spacing.
 */
const LEAD = 0.5;
const TRAIL = 1.0;

/** The depth of the more-than-half-lit window. Must stay under one layer. */
export const SWEEP_SPAN = LEAD / 2 + TRAIL / 2;

/**
 * How far through the current sweep, 0 to 1, or null when none is running.
 *
 * `from` is negative before the first poll lands, and the phase runs past 1
 * once the sweep has finished and is waiting for the next read.
 */
export function sweepPhase(elapsed: number, from: number, seconds: number): number | null {
  if (from < 0 || seconds <= 0) return null;
  const phase = (elapsed - from) / seconds;
  return phase > 1 ? null : clamp01(phase);
}

/**
 * Where the plane is at a given phase.
 *
 * From `TRAIL` behind the oldest layer to `LEAD` in front of the newest, which
 * is what gives the first and last layers a full read rather than half of one.
 */
export function sweepZ(phase: number): number {
  const from = BACK_Z - TRAIL;
  const to = FRONT_Z + LEAD;
  return from + (to - from) * clamp01(phase);
}

/**
 * How hard the plane is reading a layer at this depth, 0 to 1.
 *
 * The plane travels from the back toward the front, so a layer it has not
 * reached yet is *nearer* the front — a larger z — than the plane, which is
 * why the sign here is the layer minus the plane and not the other way round.
 */
export function readStrength(planeZ: number, z: number): number {
  const delta = z - planeZ;
  if (delta < -TRAIL || delta > LEAD) return 0;
  // Rising, as the plane closes on it.
  if (delta >= 0) return (LEAD - delta) / LEAD;
  // Settling, once the plane has passed.
  return 1 + delta / TRAIL;
}
