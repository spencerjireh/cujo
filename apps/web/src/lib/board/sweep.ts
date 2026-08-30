/**
 * The sweep, which is the board re-reading the API (decision 68).
 *
 * It leaves the far end of the record when `GET /public/runs` returns and
 * reaches the near end as the next request is due, so its position is how far
 * the board is from reading the record again.
 *
 * It used to be a plane crossing the volume, which worked while the record was
 * a line: one depth was one run. The record is a field now (decision 70), and
 * a plane would light every run at that depth together — several at a time,
 * which is a glow passing over the record rather than an instrument taking one
 * measurement. The cursor travels the **chain** instead, so it visits the runs
 * in the order the board holds them however they are scattered.
 *
 * The envelope is asymmetric, because the two directions are not the same
 * event: a specimen the cursor has not reached is anticipating, and one it has
 * passed has just been read and is settling. Sharp on the way in, slow on the
 * way out.
 *
 * Pure, so the sequence claim is a test rather than something to squint at.
 */

import { clamp01 } from "./ease";

/** How long one sweep takes, clamped from the list query's own poll interval. */
export const SWEEP_MIN_SECONDS = 4;
export const SWEEP_MAX_SECONDS = 22;

/**
 * How far ahead of the cursor a specimen starts responding, and how far behind
 * it goes on glowing, in scene units along the chain.
 *
 * The pair of them is what makes the read sequential: the window where a
 * specimen is more than half lit is `LEAD/2 + TRAIL/2` wide, and that has to be
 * shorter than the gap between two runs on the chain for two of them never to
 * be strongly lit at once. `SWEEP_SPAN` states that width so the scene can
 * check it against a real path rather than against an assumed spacing.
 */
const LEAD = 0.36;
const TRAIL = 0.82;

/** The width of the more-than-half-lit window. Must stay under one gap. */
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
 * Where the cursor is along the chain at a given phase.
 *
 * Arc length is measured from the newest run, so the cursor runs *down* it:
 * from `TRAIL` past the far end to `LEAD` before the near one, which is what
 * gives the first and last specimens a full read rather than half of one.
 */
export function sweepArc(phase: number, chainLength: number): number {
  const from = chainLength + TRAIL;
  const to = -LEAD;
  return from + (to - from) * clamp01(phase);
}

/**
 * How hard the cursor is reading a specimen, 0 to 1.
 *
 * Both positions are distances along the chain. The cursor travels from the far
 * end toward the near one, so a specimen the cursor has not reached yet has a
 * *larger* arc than the cursor — which is why the sign here is the specimen
 * minus the cursor and not the other way round.
 */
export function readStrength(cursorArc: number, specimenArc: number): number {
  const delta = specimenArc - cursorArc;
  if (delta < -TRAIL || delta > LEAD) return 0;
  // Rising, as the cursor closes on it.
  if (delta >= 0) return (LEAD - delta) / LEAD;
  // Settling, once the cursor has passed.
  return 1 + delta / TRAIL;
}
