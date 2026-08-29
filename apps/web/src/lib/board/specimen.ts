/**
 * A run, as a shape.
 *
 * Each specimen in the chamber is four bars around a core. The core is the
 * verdict; each bar is one check, its length the time that check watched and
 * its tone how the check ended. So the silhouette of a run is its evidence: a
 * clean sweep is a balanced cross, a run whose detonation errored is lopsided
 * and red on one arm, a run with a check that never appeared is missing an arm
 * entirely.
 *
 * Pure and DOM-free, so the shape is unit-tested without a renderer. `scene.ts`
 * turns what this returns into geometry and nothing else.
 */

import {
  CHECK_NAMES,
  type CheckName,
  type RunSummary,
  type Severity,
  isLive,
} from "@/lib/api/types";
import {
  type FindingCounts,
  OUTCOME_TONE,
  SEVERITY_ORDER,
  SEVERITY_TONE,
  type Tone,
  checkOutcome,
  checksOf,
  findingTotal,
  statusTone,
  worstSeverity,
} from "./tone";
import type { CheckOutcome } from "./tone";

export interface SpecimenBar {
  name: CheckName;
  outcome: CheckOutcome;
  tone: Tone;
  /**
   * 0 to 1 of the longest arm the chamber draws. Zero means "do not draw an
   * arm": the check never appeared, and a stub would claim it ran briefly.
   */
  length: number;
}

/** One finding, as a mark on the drop line. Worst nearest the core. */
export interface SpecimenMark {
  severity: Severity;
  tone: Tone;
}

export interface Specimen {
  id: string;
  /** Newest first, which is also front-to-back in the chamber. */
  index: number;
  /** What the pull request calls itself, or its number when it has no title. */
  label: string;
  /** `owner/name #N`, always, so a callout can name the run even when titled. */
  pullRequest: string;
  status: RunSummary["status"];
  tone: Tone;
  live: boolean;
  bars: SpecimenBar[];
  /** True when no digest was folded, so the arms are unknown rather than absent. */
  unmeasured: boolean;
  /** What the run found, by severity. All zeroes on a run that found nothing. */
  findings: FindingCounts;
  /** How many of those there were, which `marks` may have had to cap. */
  findingTotal: number;
  /** The worst one, or null when the run is clean. Decides `coreScale`. */
  worst: Severity | null;
  /** The findings as drawable marks, worst first, capped at `MARK_CAP`. */
  marks: SpecimenMark[];
  /**
   * How much bigger the core is drawn than a clean run's. Size and not only
   * hue, so a dangerous run reads from the back of the volume where fog has
   * already taken most of the colour out of it.
   */
  coreScale: number;
  /** How long the whole run took, for the callout. Null while it is running. */
  durationMs: number | null;
}

/** Shortest arm the chamber will draw, so a fast check is still visible. */
const MIN_LENGTH = 0.18;

/**
 * How many finding marks a drop line holds before it stops being countable.
 *
 * Past six the marks merge into a dashed line and the eye reads "several"
 * rather than a number — at which point drawing more is claiming a precision
 * the drawing has lost. `findingTotal` carries the real count for the callout
 * and the record row, and `coreScale` still grows with the worst severity, so
 * nothing is hidden by the cap.
 */
const MARK_CAP = 6;

/** No findings, which is the shape a run with no digest also reports. */
const NO_FINDINGS: FindingCounts = { critical: 0, warn: 0, info: 0 };

/**
 * How much a core grows with what its run found.
 *
 * Three steps and not a continuous ramp over the count: the claim being drawn
 * is "this run found something of this severity", and a run with two criticals
 * is not twice as dangerous as a run with one.
 */
const CORE_SCALE: Record<Severity, number> = { critical: 1.8, warn: 1.4, info: 1.15 };

function marksFrom(counts: FindingCounts): SpecimenMark[] {
  const marks: SpecimenMark[] = [];
  for (const severity of SEVERITY_ORDER) {
    for (let i = 0; i < (counts[severity] ?? 0) && marks.length < MARK_CAP; i += 1) {
      marks.push({ severity, tone: SEVERITY_TONE[severity] });
    }
  }
  return marks;
}

/**
 * What an arm is when the check reported no duration — running now, or folded
 * before the stamps existed. Deliberately between the minimum and the middle:
 * long enough to read as an arm, short enough that it never looks measured.
 */
const UNKNOWN_LENGTH = 0.32;

/**
 * The arm length that means "as long as this board has seen".
 *
 * p95 rather than the maximum, so one pathological run does not flatten every
 * other specimen into a dot; and one scale across the whole chamber rather than
 * per run, so a slow run is visibly bigger than a fast one. Null when nothing
 * measured anything, in which case every arm falls back to `UNKNOWN_LENGTH`.
 */
export function armScale(runs: RunSummary[]): number | null {
  const values: number[] = [];
  for (const run of runs) {
    for (const name of CHECK_NAMES) {
      const ms = checksOf(run)[name]?.ms;
      if (typeof ms === "number" && ms > 0) values.push(ms);
    }
  }
  if (values.length === 0) return null;
  const sorted = values.sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

function barsFor(run: RunSummary, scale: number | null): SpecimenBar[] {
  const checks = checksOf(run);
  return CHECK_NAMES.map((name) => {
    const check = checks[name];
    const outcome = checkOutcome(check);
    const tone = OUTCOME_TONE[outcome];
    if (outcome === "absent") return { name, outcome, tone, length: 0 };
    const ms = check?.ms;
    if (typeof ms !== "number" || scale === null || scale <= 0) {
      return { name, outcome, tone, length: UNKNOWN_LENGTH };
    }
    return { name, outcome, tone, length: Math.min(1, Math.max(MIN_LENGTH, ms / scale)) };
  });
}

/**
 * The newest `limit` runs as specimens, newest first.
 *
 * Trimmed rather than compressed: past the limit the chamber would be drawing
 * specimens a pixel apart behind the fog wall, which is a scatter and not a
 * record. The record below the chamber still lists every run.
 */
export function specimensFrom(runs: RunSummary[], limit: number): Specimen[] {
  const visible = runs.slice(0, Math.max(0, limit));
  const scale = armScale(visible);
  return visible.map((run, index) => {
    // A run with no digest found nothing *that anyone knows of*, which the
    // `unmeasured` flag already says. Zeroes here rather than a null shape, so
    // every reader draws the same empty drop line and the callout says
    // "no checks folded" instead of "0 findings".
    const findings = run.digest?.findings ?? NO_FINDINGS;
    const worst = worstSeverity(run.digest?.findings);
    return {
      id: run.id,
      index,
      label: run.pr_title ?? `${run.repo} #${run.pr_number}`,
      pullRequest: `${run.repo} #${run.pr_number}`,
      status: run.status,
      tone: statusTone(run.status),
      live: isLive(run.status),
      bars: barsFor(run, scale),
      unmeasured: !run.digest,
      findings,
      findingTotal: findingTotal(run.digest?.findings),
      worst,
      marks: marksFrom(findings),
      coreScale: worst === null ? 1 : CORE_SCALE[worst],
      durationMs: run.digest?.durationMs ?? null,
    };
  });
}
