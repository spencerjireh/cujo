/**
 * The four levels, and the one rule worth stating: silence must not be
 * reachable by a typo.
 *
 * Compose passes an unset optional as the empty string, so `""`, `undefined`
 * and a misspelled word all resolve to `info` rather than to a level that
 * emits nothing — the same defensiveness `config.ts` applies to its numeric
 * settings. A logger that can be switched off by accident is worse than one
 * with no switch at all.
 */

export type Level = "debug" | "info" | "warn" | "error";

/**
 * Ranked so `emit` can decide with one integer comparison, before it scrubs a
 * single value or builds a single object. A suppressed `debug` has to be
 * free: the public stream and the run poll both call one on a hot path.
 */
export const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function parseLevel(raw: string | undefined): Level {
  const value = (raw ?? "").trim().toLowerCase();
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a level of
  // "constructor" or "toString" would otherwise pass and then index to
  // `undefined`, which compares false against every rank and silences the log.
  return Object.hasOwn(RANK, value) ? (value as Level) : "info";
}
