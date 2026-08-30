/**
 * The window before the first check, as something the timeline can draw.
 *
 * `apps/cujo` has measured this since decision 67 and publishes four stamps and
 * a message count on every run. Nothing drew it, and the omission was visible:
 * `ChecksTimeline` starts its axis at the earliest check, so a run that took
 * six minutes showed two minutes of lanes and said nothing about the other
 * four. Decision 67 exists because that gap is where the time actually goes —
 * 17 to 28 seconds of execution inside 500 to 630 seconds of wall clock — so
 * leaving it off the one drawing that claims to account for a run's time was
 * the page contradicting the measurement.
 *
 * Pure, so `tests/lib/board/setup.test.ts` covers it. Every stamp on the wire
 * is nullable and two of them are legitimately absent, so nothing here infers a
 * missing end from a present start: a span it cannot stand behind is null, the
 * way `settleSetup` refuses to publish a negative one.
 */

import type { SetupTimings } from "@/lib/api/types";

export interface SetupWindow {
  /** Epoch ms of the run's first `turn.created`: where Cujo's own work began. */
  startedAt: number;
  /** Epoch ms of the first thread named for a check. Setup is over here. */
  endedAt: number;
  /** `endedAt − startedAt`. Zero is possible and is not an error. */
  lengthMs: number;
  /**
   * Daytona provisioning as a share of the lane, 0–1, or null.
   *
   * Null is a fact rather than a gap, and it is the interesting one: the
   * `sandbox.created` event is session-scoped, so a second run on the same pull
   * request never sees it — the sandbox was already there. That is precisely
   * why a re-run is faster, and drawing zero would have said the opposite.
   */
  provisionShare: number | null;
  /**
   * `agentStartedAt` → `firstCheckAt`: the part the rubric can actually move,
   * since every mechanical step the parent runs itself is more of this. Null
   * when the stamps cannot support it.
   */
  thinkingMs: number | null;
  /** Main-thread messages before the first check. The round trips setup cost. */
  messages: number;
}

/** A stamp, or NaN. Optional as well as nullable: an older frame carries none. */
function stamp(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

/**
 * A span between two stamps, or null.
 *
 * Refuses a negative exactly where `settleSetup` refuses one, and for its
 * reason rather than as a rounding guard: both ends are harness event
 * timestamps off one clock, so there is no honest way for the subtraction to
 * come out negative. If it does, the events are not what we think they are and
 * a number is worse than none.
 */
function span(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const ms = to - from;
  return ms >= 0 ? ms : null;
}

/**
 * The window, or null when there is nothing drawable.
 *
 * Both ends are required: a lane needs somewhere to start and somewhere to
 * stop, and a run whose first check never arrived has no setup *window* — it
 * has a setup that did not finish, which the timeline already shows by having
 * no lanes at all.
 */
export function setupWindow(setup: SetupTimings | null | undefined): SetupWindow | null {
  if (!setup) return null;
  const startedAt = stamp(setup.turnCreatedAt);
  const endedAt = stamp(setup.firstCheckAt);
  const lengthMs = span(startedAt, endedAt);
  if (lengthMs === null) return null;

  return {
    startedAt,
    endedAt,
    lengthMs,
    provisionShare: provisionShare(setup, startedAt, lengthMs),
    thinkingMs: thinkingMs(setup),
    messages: setup.messages,
  };
}

/**
 * How much of the lane Daytona accounted for.
 *
 * Clamped into the lane rather than trusted: these are two harness stamps and
 * the arithmetic below is sound, but a bar wider than the lane it sits in would
 * be a drawing that is wrong, and clamping costs nothing. A zero-length window
 * has no share to take — dividing by it would be the one way this returns a
 * number nobody measured.
 */
function provisionShare(setup: SetupTimings, startedAt: number, lengthMs: number): number | null {
  if (lengthMs <= 0) return null;
  const provisioned = span(startedAt, stamp(setup.sandboxCreatedAt));
  if (provisioned === null) return null;
  return Math.min(1, provisioned / lengthMs);
}

/**
 * The thinking span.
 *
 * `apps/cujo` computes this as `ms` and publishes it, so that is what is read
 * first — one number settled on the trusted side beats the same subtraction
 * done again here. The fallback covers a run stored before `settleSetup` filled
 * the field, where the two stamps are still on the record.
 */
function thinkingMs(setup: SetupTimings): number | null {
  if (typeof setup.ms === "number" && Number.isFinite(setup.ms) && setup.ms >= 0) {
    return setup.ms;
  }
  return span(stamp(setup.agentStartedAt), stamp(setup.firstCheckAt));
}
