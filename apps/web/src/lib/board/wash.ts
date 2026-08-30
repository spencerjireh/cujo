/**
 * The wash, which is the board re-reading the API (decision 68, as amended by
 * 81).
 *
 * It starts when `GET /public/runs` returns and walks the record run by run,
 * oldest first, ending on the newest. A run's index is its age, and the
 * layers are contiguous ranges of index (`galaxy.ts`), so walking index
 * order *is* reading the back layer, then the middle, then the front, and one
 * layer is finished before the next is begun. That is the sequence the test
 * asserts.
 *
 * It replaces a plane crossing the volume (80). A plane lights a layer at
 * once, and a layer of fourteen stars going amber together, every five
 * seconds while a run is live, was a strobe. The wash is a light that hops
 * from star to star: `washCursor` says where it is, `lightOpacity` says how
 * visible it is (it fades in at the oldest star and out at the newest), and
 * `readStrength` says how hard it is reading each star. It takes a second
 * and a half per star and at least fifteen seconds whatever the poll
 * interval, and a poll that lands while one is walking does not start
 * another.
 *
 * The envelope is asymmetric, because the two directions are not the same
 * event: a run the cursor has not reached is anticipating, and one it has
 * passed has just been read and is settling. Sharp on the way in, slow on the
 * way out.
 *
 * Pure, so the sequence claim is a test rather than something to squint at.
 */

import { clamp01 } from "./ease";

/** The floor on a wash, whatever the poll interval and however few runs. */
export const WASH_MIN_SECONDS = 15;
/** How long the light spends per star. A hop shorter than this darts. */
export const SECONDS_PER_RUN = 1.5;

/**
 * How long a wash over `count` runs takes, given the poll interval it is
 * drawing. The longest of the three: a light that finished before the next
 * read would have nothing to say, and one that hopped faster than a reader
 * can follow would say it badly.
 */
export function washSeconds(intervalMs: number, count: number): number {
  return Math.max(intervalMs / 1000, WASH_MIN_SECONDS, SECONDS_PER_RUN * Math.max(0, count));
}

/**
 * How far ahead of the cursor a run starts responding, and how far behind it
 * it goes on glowing, in runs.
 *
 * The cursor walks *down* the index, so "ahead" is a lower index. The window
 * where a run is more than half lit is `LEAD/2 + TRAIL/2` runs wide, which
 * is what keeps the read sequential: two runs, never three, are strongly lit
 * at once.
 */
const LEAD = 1.0;
const TRAIL = 2.0;

/** The width of the more-than-half-lit window, in runs. */
export const WASH_SPAN = LEAD / 2 + TRAIL / 2;

/**
 * How far through the current wash, 0 to 1, or null when none is walking.
 *
 * `from` is negative before the first poll lands, and the phase runs past 1
 * once the wash has finished and is waiting for the next read.
 */
export function washPhase(elapsed: number, from: number, seconds: number): number | null {
  if (from < 0 || seconds <= 0) return null;
  const phase = (elapsed - from) / seconds;
  return phase > 1 ? null : clamp01(phase);
}

/**
 * Where the cursor is at a given phase, as an index into a record of `count`
 * runs.
 *
 * From `TRAIL` past the oldest run to `LEAD` before the newest, which is what
 * gives the first and last runs a full read rather than half of one.
 */
export function washCursor(phase: number, count: number): number {
  const from = Math.max(0, count - 1) + TRAIL;
  const to = -LEAD;
  return from + (to - from) * clamp01(phase);
}

/**
 * How visible the light is at this cursor, 0 to 1.
 *
 * The cursor overshoots both ends of the record so the first and last runs
 * get a full read; the light uses that overshoot to arrive and to leave.
 * Full while it is between the oldest run and the newest, fading in over
 * `TRAIL` before the oldest and out over `LEAD` past the newest.
 */
export function lightOpacity(cursor: number, count: number): number {
  const last = Math.max(0, count - 1);
  if (cursor > last) return clamp01(1 - (cursor - last) / TRAIL);
  if (cursor < 0) return clamp01(1 + cursor / LEAD);
  return 1;
}

/**
 * How hard the cursor is reading the run at this index, 0 to 1.
 *
 * The cursor travels toward index zero, so a run it has not reached yet has a
 * *lower* index than the cursor, which is why the sign here is the cursor
 * minus the run and not the other way round.
 */
export function readStrength(cursor: number, index: number): number {
  const delta = cursor - index;
  if (delta < -TRAIL || delta > LEAD) return 0;
  // Rising, as the cursor closes on it.
  if (delta >= 0) return (LEAD - delta) / LEAD;
  // Settling, once the cursor has passed.
  return 1 + delta / TRAIL;
}
