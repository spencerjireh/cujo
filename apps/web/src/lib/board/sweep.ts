/**
 * The sweep, which is the board re-reading the API (decision 68).
 *
 * The plane leaves the back wall when `GET /public/runs` returns and reaches
 * the front as the next request is due, so its position is how far the board is
 * from reading the record again. That much was already true. What was not is
 * the *reading*: the scene lifted every specimen within `SWEEP_REACH` of the
 * plane by a linear falloff, and at a reach of 1.1 against a slot spacing of
 * 0.58 that is nearly two slots either side — four specimens brightening
 * together, which reads as a glow passing over the record rather than as an
 * instrument taking one measurement at a time.
 *
 * The envelope here is narrow enough that the plane reads one specimen at a
 * time, and asymmetric because those two directions are not the same event: a
 * specimen the plane has not reached is anticipating, and one it has passed has
 * just been read and is settling. Sharp on the way in, slow on the way out.
 *
 * Pure, so the sequence claim is a test rather than something to squint at.
 */

import { BACK_Z, FRONT_Z, SPACING, slotZ } from "./chamber-layout";
import { clamp01 } from "./ease";

/** How long one sweep takes, clamped from the list query's own poll interval. */
export const SWEEP_MIN_SECONDS = 4;
export const SWEEP_MAX_SECONDS = 22;

/** Where the plane stops, just past the open face. */
const SWEEP_END_Z = FRONT_Z + 0.8;

/**
 * How far ahead of the plane a specimen starts responding, and how far behind
 * it goes on glowing.
 *
 * Both are shorter than `SPACING` on purpose, and the pair of them is what
 * makes the read sequential: the window where a specimen is more than half lit
 * is `LEAD/2 + TRAIL/2` wide, which has to be under one slot for two specimens
 * never to be strongly lit at once.
 */
const LEAD = 0.22;
const TRAIL = 0.5;

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

/** Where the plane is at a given phase: back wall to just past the open face. */
export function sweepPlaneZ(phase: number): number {
  return BACK_Z + (SWEEP_END_Z - BACK_Z) * clamp01(phase);
}

/**
 * How hard the plane is reading a specimen, 0 to 1.
 *
 * The plane travels from the back wall forward, so a specimen with `planeZ`
 * below its own z has not been reached yet.
 */
export function readStrength(planeZ: number, specimenZ: number): number {
  const delta = planeZ - specimenZ;
  if (delta < -LEAD || delta > TRAIL) return 0;
  // Rising into the plane.
  if (delta <= 0) return (delta + LEAD) / LEAD;
  // Settling behind it.
  return 1 - delta / TRAIL;
}

/**
 * Which slot the plane is over right now, or null between two of them.
 *
 * The scene does not need this to draw — `readStrength` is per specimen — but
 * it is what makes "reads one at a time" statable, and the test reads it.
 */
export function readingIndex(planeZ: number, count: number): number | null {
  if (count <= 0) return null;
  const index = Math.round((FRONT_Z - planeZ) / SPACING);
  if (index < 0 || index >= count) return null;
  return Math.abs(slotZ(index) - planeZ) <= SPACING / 2 ? index : null;
}
