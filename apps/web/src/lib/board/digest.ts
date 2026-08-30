/**
 * The detail shape, reduced to the digest a list row carries.
 *
 * `apps/cujo` derives this server-side and publishes it on every list row
 * (decision 65), so the board never needs it. The run page does: it holds one
 * run in the detail shape, which carries `checks` and `findings` in full and no
 * digest at all, and the specimen drawn beside its title is built from a digest.
 *
 * Borrowing the list row's copy is not an option. The stream reducer patches
 * only `status` and `updated_at` into that row (`lib/api/stream.ts`), so a live
 * run's digest is whatever the last poll saw — a specimen drawn from it would
 * show arms that stopped growing while the run kept going.
 *
 * A port of `apps/cujo/src/review/digest.ts` and deliberately a faithful one:
 * the same reduction has to give the same answer on both sides of the wire, or
 * the specimen in the chamber and the specimen on the run page disagree about
 * the same run. Every rule below is that file's rule, and the contract test
 * type-checks the result against the shape `apps/cujo` publishes.
 *
 * Pure, so `tests/lib/board/digest.test.ts` covers it without a DOM. Nothing
 * here reads a clock: a run that never ended has a null duration rather than
 * one measured against now.
 */

import { CHECK_NAMES, type CheckName, type CheckState } from "@/lib/api/types";
import type { DigestCheck, Run, RunDigest, Severity } from "@/lib/api/types";

/** Every severity the product emits, so a count is never a missing key. */
const NO_FINDINGS: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };

/**
 * A stamp, or NaN.
 *
 * Wider than the server's input by one case, and the difference is real: on the
 * wire these are optional as well as nullable, because a `run` frame from an
 * older release carries no key at all. Both absences mean the same thing here —
 * unknown — and every caller filters on `Number.isFinite`.
 */
function stamp(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function checkMs(check: CheckState): number | null {
  const started = stamp(check.startedAt);
  const ended = stamp(check.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const ms = ended - started;
  return ms >= 0 ? ms : null;
}

/**
 * The checks run concurrently in one sandbox, so the envelope is what the run
 * took and not the sum of the four.
 *
 * Null unless *every* check has a usable interval of its own, which is the
 * server's rule and is two conditions rather than one: both stamps present, and
 * ordered. A check stamped backwards beside a check stamped forwards yields a
 * positive span even though its own `ms` is correctly null, so the test is
 * whether `checkMs` returned a number — not whether the two lists are the same
 * length.
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

export function digestFrom(run: Run): RunDigest {
  // Only the four named checks. The parent thread and any subagent the rubric
  // did not name are `isCheck: false`, and a digest keyed by check name has
  // nowhere to put them.
  const named = new Map<CheckName, CheckState>();
  for (const check of run.checks) {
    if (!check.isCheck) continue;
    const name = CHECK_NAMES.find((candidate) => candidate === check.title);
    // First writer wins, as on the server: two threads carrying one check's
    // name is not a shape the fold produces, and if it ever did, the earlier
    // one is the run's.
    if (name && !named.has(name)) named.set(name, check);
  }

  const checks: Partial<Record<CheckName, DigestCheck>> = {};
  for (const [name, check] of named) {
    checks[name] = {
      status: check.status,
      ms: checkMs(check),
      // Off the check's own timings, exactly as the server reads them. The
      // detail route publishes `timings` in full, so this page has the number
      // the list row was given — and if it read it differently, the specimen
      // here and the specimen in the chamber would disagree about one run.
      sandboxMs: check.timings?.sandboxMs ?? null,
    };
  }

  const findings = { ...NO_FINDINGS };
  for (const finding of run.findings) {
    // A severity the fold does not emit would create a key the wire shape does
    // not declare; the three it does emit are matched literally.
    if (finding.severity in findings) findings[finding.severity] += 1;
  }

  return { checks, findings, durationMs: spanMs([...named.values()]) };
}
