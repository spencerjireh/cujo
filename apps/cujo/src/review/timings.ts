/**
 * Where a check's time went: thinking, or running the code under review.
 *
 * Both halves are already in the run and neither was ever put together. A
 * thread carries its own `createdAt` at both ends, and every `sniff.py` report
 * inside it carries the `duration_s` of the command it wrapped. The difference
 * between the two is the part of the check that was a model deciding what to do
 * next — which is the number that says whether a slow review is slow because
 * the test suite is slow, or because the agent is.
 *
 * Nothing here reads a clock. The inputs are event timestamps and report
 * fields, so a rehydrated run computes exactly what the live one did.
 *
 * **Every field is omitted rather than guessed.** That rule is inherited from
 * `durationOf`, which this replaces: a check whose thread events carried no
 * timestamp has no honest duration, and a zero would read as an instantaneous
 * check. It matters most for `modelMs` — see below.
 */

import type { CheckState } from "./types";

export interface CheckTimings {
  /** Wall time of the sub-agent thread, from its own two event timestamps. */
  wallMs?: number;
  /** Time inside `sniff.py run` and `sniff.py detonate`, summed over `runs[]`. */
  sandboxMs?: number;
  /** What is left: the sub-agent thinking, and the harness around it. */
  modelMs?: number;
}

/** The thread's own two timestamps, or nothing. */
function wallMs(check: CheckState): number | undefined {
  if (!check.startedAt || !check.endedAt) return undefined;
  const ms = Date.parse(check.endedAt) - Date.parse(check.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * The wrapped commands' own measurement, summed.
 *
 * Read as leniently as the hard rules read the same reports: a `runs[]` that is
 * not an array, or an entry whose `duration_s` is not a number, contributes
 * nothing rather than failing the whole sum. A report that carries no `runs[]`
 * at all has not measured zero sandbox time — it has measured none, which is
 * `undefined`.
 */
function sandboxMs(check: CheckState): number | undefined {
  const report = check.report;
  if (!report || typeof report !== "object" || Array.isArray(report)) return undefined;
  const runs = (report as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return undefined;
  let total = 0;
  for (const run of runs) {
    const seconds = (run as { duration_s?: unknown })?.duration_s;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      total += seconds * 1000;
    }
  }
  return Math.round(total);
}

/**
 * Where the run went before any check existed.
 *
 * `checkTimings` answers "was this check slow because the suite was slow, or
 * because the agent was". This answers the question one level up, which nothing
 * could answer at all: a measured run spent 84 to 156 seconds between the claim
 * and the first check spawning, and no field said whether that was Daytona
 * provisioning a sandbox or the parent taking a dozen round trips to clone a
 * repository. Those two have opposite fixes.
 *
 * Four stamps rather than one duration, because the useful spans are between
 * them and two of the four ends live outside the projection — the claim is
 * `RunRecord.createdAt`, and a reader subtracts. Storing spans instead would
 * pick the subtractions for them.
 */
export interface SetupTimings {
  /** The run's first `turn.created`. Claim to here is `apps/cujo`'s own work. */
  turnCreatedAt: string | null;
  /**
   * `sandbox.created`, which is where Daytona provisioning ends.
   *
   * Null is a fact and not a gap. The event is session-scoped and `hydrate`
   * scopes a fold to this run's own turns, so a second run on the same pull
   * request never sees one: the sandbox was already there. That is precisely
   * why a re-run is faster, and a zero would have said the opposite.
   */
  sandboxCreatedAt: string | null;
  /** The parent's first `model.message` on `"main"`: it has started thinking. */
  agentStartedAt: string | null;
  /** The first `thread.created` titled for a check. Setup is over here. */
  firstCheckAt: string | null;
  /**
   * Main-thread messages before that first check, which is the round-trip count
   * setup cost. The number the rubric can actually move: every mechanical step
   * the parent runs as its own command is one more of these.
   */
  messages: number;
  /** `agentStartedAt` to `firstCheckAt`. Omitted unless both stamps are usable. */
  ms?: number;
}

export function emptySetup(): SetupTimings {
  return {
    turnCreatedAt: null,
    sandboxCreatedAt: null,
    agentStartedAt: null,
    firstCheckAt: null,
    messages: 0,
  };
}

/**
 * Fill in `ms` once both ends are known. Called where `firstCheckAt` is set.
 *
 * A plain ordering guard is enough here, unlike `checkTimings` below, and the
 * difference is worth naming: both of these stamps are harness event
 * timestamps off one clock, where `modelMs` subtracts a `time.monotonic()`
 * measured inside the sandbox from a span between two harness stamps. There is
 * no honest way for this subtraction to come out negative, so if it does, the
 * events are not what we think they are and a number is worse than none.
 */
export function settleSetup(setup: SetupTimings): void {
  if (!setup.agentStartedAt || !setup.firstCheckAt) return;
  const ms = Date.parse(setup.firstCheckAt) - Date.parse(setup.agentStartedAt);
  if (Number.isFinite(ms) && ms >= 0) setup.ms = ms;
}

export function checkTimings(check: CheckState): CheckTimings {
  const wall = wallMs(check);
  const sandbox = sandboxMs(check);
  const timings: CheckTimings = {};
  if (wall !== undefined) timings.wallMs = wall;
  if (sandbox !== undefined) timings.sandboxMs = sandbox;
  // Omitted when it comes out negative, and that is not a rounding guard: the
  // two inputs come off different clocks. `duration_s` is `time.monotonic()`
  // inside the sandbox and `wallMs` is the difference between two event
  // timestamps the harness wrote, so on a short check the sandbox can honestly
  // account for more milliseconds than the thread appears to have lasted.
  // Publishing a negative "thinking time" would be worse than publishing none.
  if (wall !== undefined && sandbox !== undefined && wall >= sandbox) {
    timings.modelMs = wall - sandbox;
  }
  return timings;
}
