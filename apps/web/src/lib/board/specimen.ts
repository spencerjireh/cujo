/**
 * A run, as a shape.
 *
 * Each specimen in the chamber is a star system: a core with four rings round
 * it, each on its own tilt (`orbit.ts`). The core is the verdict; each ring is
 * one check, its radius the time that check watched, its bright arc the share
 * of that spent in the sandbox, and its tone how the check ended. So the
 * silhouette of a run is its evidence: a clean sweep is four even rings, a run
 * whose detonation errored has one red ring, a run with a check that never
 * appeared is missing a ring entirely, and a run the agent spent longer
 * thinking about than running is mostly faint.
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
import { SATELLITE_SLOTS } from "./orbit";
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
   * 0 to 1 of the widest ring the chamber draws. Zero means "do not draw a
   * ring": the check never appeared, and a stub would claim it ran briefly.
   */
  length: number;
  /**
   * How much of the ring was the sandbox executing the pull request, 0 to 1,
   * drawn as the bright arc of it. The rest is the sub-agent deciding what to
   * do next — the same split the run page's timeline draws as a lane.
   *
   * Null means the check measured no share, which is not zero: a zero would
   * draw a ring that was all model on a check that ran a test suite. A ring
   * with a null share is drawn whole, exactly as `ChecksTimeline` draws a
   * lane for a check with no `timings`.
   */
  solid: number | null;
  /**
   * The measurements the ring is drawn from, carried so the callout can say
   * them: how long the check ran and how much of that was the sandbox. Null
   * where the digest had none, as `DigestCheck` has them.
   */
  ms: number | null;
  sandboxMs: number | null;
}

/** One finding, as a satellite on the orbit outside the rings. Worst first. */
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
  /** True when no digest was folded, so the rings are unknown rather than absent. */
  unmeasured: boolean;
  /** What the run found, by severity. All zeroes on a run that found nothing. */
  findings: FindingCounts;
  /** How many of those there were, which `marks` may have had to cap. */
  findingTotal: number;
  /** The worst one, or null when the run is clean. Decides `coreScale`. */
  worst: Severity | null;
  /** The findings as drawable marks, worst first, capped at `SATELLITE_SLOTS`. */
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

/** Smallest ring the chamber will draw, so a fast check is still visible. */
const MIN_LENGTH = 0.18;

/**
 * How many finding marks a specimen holds before it stops being countable.
 *
 * Past six the marks merge and the eye reads "several" rather than a number —
 * at which point drawing more is claiming a precision the drawing has lost.
 * `findingTotal` carries the real count for the callout and the record row, and
 * `coreScale` still grows with the worst severity, so nothing is hidden by it.
 *
 * The number lives with the orbit it fills (`orbit.ts`) rather than here: the
 * cap and the number of slots around the core are one fact, and two constants
 * would let a mark be produced with nowhere to sit.
 */
const MARK_CAP = SATELLITE_SLOTS;

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
 * What a ring is when the check reported no duration — running now, or folded
 * before the stamps existed. Deliberately between the minimum and the middle:
 * wide enough to read as a ring, small enough that it never looks measured.
 */
const UNKNOWN_LENGTH = 0.32;

/**
 * The ring radius that means "as long as this board has seen".
 *
 * p95 rather than the maximum, so one pathological run does not flatten every
 * other specimen into a dot; and one scale across the whole chamber rather than
 * per run, so a slow run is visibly bigger than a fast one. Null when nothing
 * measured anything, in which case every ring falls back to `UNKNOWN_LENGTH`.
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

/**
 * The fraction of a check that was the sandbox, or null when it measured none.
 *
 * Guarded on both numbers rather than on `sandboxMs` alone: a share of a
 * duration nobody measured has no meaning, and the ratio is clamped because a
 * sandbox that reported longer than the thread it ran in is a broken
 * measurement, not a ring that overflows its own radius.
 */
function solidShare(check: { ms: number | null; sandboxMs: number | null } | undefined) {
  const ms = check?.ms;
  const sandboxMs = check?.sandboxMs;
  if (typeof ms !== "number" || ms <= 0) return null;
  if (typeof sandboxMs !== "number" || sandboxMs < 0) return null;
  return Math.min(1, sandboxMs / ms);
}

function barsFor(run: RunSummary, scale: number | null): SpecimenBar[] {
  const checks = checksOf(run);
  return CHECK_NAMES.map((name) => {
    const check = checks[name];
    const outcome = checkOutcome(check);
    const tone = OUTCOME_TONE[outcome];
    if (outcome === "absent") {
      return { name, outcome, tone, length: 0, solid: null, ms: null, sandboxMs: null };
    }
    const solid = solidShare(check);
    const ms = check?.ms ?? null;
    const sandboxMs = check?.sandboxMs ?? null;
    if (typeof ms !== "number" || scale === null || scale <= 0) {
      return { name, outcome, tone, length: UNKNOWN_LENGTH, solid, ms, sandboxMs };
    }
    return {
      name,
      outcome,
      tone,
      length: Math.min(1, Math.max(MIN_LENGTH, ms / scale)),
      solid,
      ms,
      sandboxMs,
    };
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
    // every reader draws the same empty orbit and the callout says
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

/**
 * Everything about a specimen that reaches the drawing, as one string.
 *
 * The chamber rebuilds a node's geometry when its run changes, and "changes"
 * has to mean *would be drawn differently* rather than "is a new object" — the
 * list is refetched every five seconds and returns an equal record almost every
 * time. Comparing the two ends of that is what lets a poll leave twenty-four
 * nodes alone and rebuild the one whose detonation just went red.
 *
 * It is the literal encoding of decision 68's third rule — two runs look alike
 * only if they ran alike — so it belongs beside the shape it summarises rather
 * than in the scene that consumes it. Anything absent from this string is a
 * fact the drawing does not carry; `index` is deliberately not in it, because a
 * specimen that only moved slot is the same specimen and slides rather than
 * being rebuilt.
 */
export function specimenSignature(spec: Specimen): string {
  // `solid` is in the string because it is drawn: a ring whose sandbox share
  // changed is a different ring, and a poll that only learned the share would
  // otherwise leave the old geometry standing.
  const bars = spec.bars.map(
    (bar) =>
      `${bar.name}:${bar.outcome}:${bar.length.toFixed(3)}:${bar.solid === null ? "whole" : bar.solid.toFixed(3)}`,
  );
  const marks = spec.marks.map((mark) => mark.severity);
  return [
    spec.status,
    spec.tone,
    spec.live ? "live" : "still",
    spec.unmeasured ? "unmeasured" : "measured",
    spec.coreScale.toFixed(2),
    bars.join(","),
    marks.join(","),
  ].join("|");
}
