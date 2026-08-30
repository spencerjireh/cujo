/**
 * The projection, reduced to what a list row can hold (decision 65).
 *
 * Pure, like `fold`, and for the same reason: it is called once per fold and
 * again on demand for a run whose digest predates the table, and both callers
 * must get the same answer from the same projection. Nothing here reads a
 * clock — a run that never ended has a null duration rather than one measured
 * against now, which is what `updatedAt` already means and what this exists to
 * stop the board from mistaking for a run that took four hours.
 */

import { CHECK_NAMES, type CheckName, type CheckState, type Projection } from "./types";
import type { DigestCheck, RunDigest, Severity } from "./types";

/** Every severity the product emits, so a count is never a missing key. */
const NO_FINDINGS: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };

/**
 * A stamp, or NaN. `Date.parse` returns NaN for a malformed string and every
 * caller below filters on `Number.isFinite`, so a projection written by an
 * older fold degrades to "unknown" rather than to a negative duration.
 */
function stamp(value: string | null): number {
  return value ? Date.parse(value) : Number.NaN;
}

/**
 * One check's own wall time, or null while it runs and on a check whose stamps
 * are missing or backwards. Exported because the Discord card's Checks field
 * says the same thing the digest does (decision 80): what the check measured,
 * not a verdict glyph.
 */
export function checkMs(check: CheckState): number | null {
  const started = stamp(check.startedAt);
  const ended = stamp(check.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const ms = ended - started;
  return ms >= 0 ? ms : null;
}

export function deriveDigest(projection: Projection): RunDigest {
  // Only the four named checks. The parent thread and any subagent the rubric
  // did not name are `isCheck: false`, and a digest keyed by check name has
  // nowhere to put them.
  const named = new Map<CheckName, CheckState>();
  for (const check of projection.checks) {
    if (!check.isCheck) continue;
    const name = CHECK_NAMES.find((candidate) => candidate === check.title);
    // First writer wins. Two threads with one check's name is not a shape the
    // fold produces, and if it ever did, the earlier one is the run's.
    if (name && !named.has(name)) named.set(name, check);
  }

  const checks: Partial<Record<CheckName, DigestCheck>> = {};
  for (const [name, check] of named) {
    checks[name] = { status: check.status, ms: checkMs(check) };
  }

  const findings = { ...NO_FINDINGS };
  for (const finding of projection.findings) {
    // A severity the fold does not emit would otherwise create a key the wire
    // shape does not declare; the three it does emit are matched literally.
    if (finding.severity in findings) findings[finding.severity] += 1;
  }

  return { checks, findings, durationMs: spanMs([...named.values()]) };
}

/**
 * The checks run concurrently in one sandbox, so the run's wall clock is the
 * envelope around all four and not the sum of them.
 *
 * Null unless *every* check has a usable interval of its own, which is two
 * conditions and both are per check rather than over the aggregate:
 *
 * - **Both stamps present.** `startedAt` and `endedAt` are recorded by
 *   different event handlers in the fold, so a projection can hold a check with
 *   only a start beside one with only an end. Counting two lists finds them
 *   equal, and the envelope then runs from one check's start to a different
 *   check's end — a duration nothing measured, on a run that has not finished.
 * - **Ordered.** `checkMs` already refuses an interval that ends before it
 *   starts, and the envelope has to refuse the same one: a check stamped
 *   backwards, beside a check stamped forwards, gives a positive aggregate
 *   span even though its own `ms` is correctly null.
 *
 * Both hold if and only if `checkMs` returns a number, so that is the test.
 */
function spanMs(checks: CheckState[]): number | null {
  if (checks.length === 0) return null;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const check of checks) {
    if (checkMs(check) === null) return null;
    first = Math.min(first, stamp(check.startedAt));
    last = Math.max(last, stamp(check.endedAt));
  }
  return last - first;
}
