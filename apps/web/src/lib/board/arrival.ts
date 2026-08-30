/**
 * What changed about the record, so a new run can arrive instead of appearing.
 *
 * `setSpecimens` tore down every node and rebuilt all of them on each poll,
 * which is correct and says nothing: a run that landed a second ago pops into
 * being at the front while the twenty-three behind it teleport back one slot,
 * and the board's most interesting moment — a review starting — is drawn as a
 * flicker. It is also the moment the sweep exists to announce, so the two were
 * working against each other.
 *
 * The diff below is where all the fiddliness lives, deliberately: it is a
 * predicate over two lists of ids, so it is exhaustively testable, and the
 * scene never re-derives it. A `rebuild` where an `advance` was expected costs
 * a visible flash of the record and nothing else, which is the right failure
 * mode for the guess this makes.
 */

import { clamp01, easeOutCubic } from "./ease";

export type RecordDiff =
  /** Same ids, same order. Nothing enters, nothing moves. */
  | { kind: "same" }
  /**
   * `count` new runs at the head, everything else shifted back by that much.
   * `leaving` fell off the tail past the chamber's capacity.
   */
  | { kind: "advance"; entering: string[]; leaving: string[]; shift: number }
  /** Anything else: a reorder, a filter, the first load. Draw it outright. */
  | { kind: "rebuild" };

/**
 * Classify one record against the last.
 *
 * An advance is the only shape worth animating and it is a narrow one: the
 * previous record has to survive intact, in order, starting at some offset. A
 * run that changed status is still an advance of zero — it holds the same ids
 * in the same order — which is why `same` is separate and why the scene rebuilds
 * only the node whose drawing changed.
 *
 * Ids are in record order, newest first.
 */
export function diffRecord(previous: readonly string[], next: readonly string[]): RecordDiff {
  if (previous.length === 0) return next.length === 0 ? { kind: "same" } : { kind: "rebuild" };
  if (same(previous, next)) return { kind: "same" };

  // How many ids at the head of `next` are new. Beyond the previous length
  // there is nothing left to match against, so it is a rebuild by definition.
  const shift = next.findIndex((id) => id === previous[0]);
  if (shift <= 0) return { kind: "rebuild" };

  // The old record has to continue, in order, from the offset. Only its tail
  // may be missing, and only because the chamber holds a fixed number of runs.
  const kept = next.slice(shift);
  for (let i = 0; i < kept.length; i += 1) {
    if (kept[i] !== previous[i]) return { kind: "rebuild" };
  }

  return {
    kind: "advance",
    entering: next.slice(0, shift),
    leaving: previous.slice(kept.length),
    shift,
  };
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface Arrival {
  /** How far in front of its slot the specimen still is, in scene units. */
  lead: number;
  /** Scale, from a point to full size. */
  scale: number;
  /** Opacity multiplier, so it fades in rather than cutting. */
  opacity: number;
}

/** How far in front of the open face a new run starts. */
const ARRIVAL_LEAD = 1.4;

/**
 * A run easing into the front slot.
 *
 * It comes from in front of the open face rather than from the back, because
 * the front is where the newest run belongs and the record is already sliding
 * the other way: two motions in the same direction would read as the whole
 * record shifting rather than as one run joining it.
 */
export function arrivalCurve(t: number): Arrival {
  const eased = easeOutCubic(t);
  return {
    lead: ARRIVAL_LEAD * (1 - eased),
    scale: 0.2 + 0.8 * eased,
    // Ahead of the other two, so the shape is solid by the time it is in place
    // rather than still fading while it settles.
    opacity: clamp01(eased * 1.6),
  };
}

/** How far through a slide, 0 to 1. Clamped, so a stale start still lands. */
export function slideProgress(startedAt: number, now: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return clamp01((now - startedAt) / seconds);
}
