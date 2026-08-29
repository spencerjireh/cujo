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
