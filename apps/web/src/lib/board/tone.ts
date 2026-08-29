/**
 * What colour a run is, in one place.
 *
 * The board draws every run twice — once as a specimen in the chamber and once
 * as a row in the record — and the two must never disagree about whether a run
 * is the dangerous kind. So the status-to-tone map lives here rather than in
 * `StatusBadge`, which is now one of its three readers.
 *
 * Two rules from brand/brand.md decide the map, and neither is cosmetic:
 * amber lands on exactly one status, `blocked_pending`, because that is the one
 * waiting on a person; and red means the pull request is dangerous and never
 * that Cujo fell over, so a run that errors is info blue.
 */

import type { CheckName, DigestCheck, RunStatus, RunSummary, Severity } from "@/lib/api/types";

/**
 * Four tones, not eight. Several statuses are the same claim about the pull
 * request — `blocked_unattended` and `blocked_posted` differ in who decided,
 * which the *label* says and the colour does not have to.
 */
export type Tone = "critical" | "amber" | "info" | "inert" | "bone";

const STATUS_TONE: Record<RunStatus, Tone> = {
  running: "inert",
  clean: "info",
  blocked_pending: "amber",
  blocked_unattended: "critical",
  blocked_posted: "critical",
  denied: "inert",
  // Cujo fell over, which is not a claim about the pull request.
  error: "info",
  superseded: "inert",
};

export function statusTone(status: RunStatus): Tone {
  return STATUS_TONE[status];
}

/** The badge classes, so a tone is written as Tailwind exactly once. */
export const TONE_TEXT: Record<Tone, string> = {
  critical: "text-sev-critical",
  amber: "text-sev-high",
  info: "text-sev-info",
  inert: "text-fg-muted",
  bone: "text-fg",
};

export const TONE_BG: Record<Tone, string> = {
  critical: "bg-sev-critical-bg",
  amber: "bg-sev-high-bg",
  info: "bg-sev-info-bg",
  inert: "bg-sev-low-bg",
  bone: "bg-bg-raised",
};

/** A solid fill in the tone itself, for a bar rather than a badge. */
export const TONE_FILL: Record<Tone, string> = {
  critical: "bg-sev-critical",
  amber: "bg-sev-high",
  info: "bg-sev-info",
  inert: "bg-fg-muted",
  bone: "bg-fg",
};

/**
 * Whether the run reached a conclusion about the pull request.
 *
 * `clean` and `error` are both info blue, which brand.md requires — red means
 * the pull request is dangerous and never that Cujo fell over. Side by side in
 * a legend that made two rows identical. So a status that produced no verdict
 * is drawn in the same hue at reduced strength: still not red, visibly not a
 * result.
 */
export function isVerdict(status: RunStatus): boolean {
  return status !== "error" && status !== "superseded" && status !== "running";
}

/**
 * The CSS custom property the chamber reads for a tone. Pinned to the dark
 * ramp, because the chamber stays dark in a light page (brand.md, "The
 * instrument viewport").
 */
export const TONE_CHAMBER_VAR: Record<Tone, string> = {
  critical: "--chamber-critical",
  amber: "--chamber-amber",
  info: "--chamber-info",
  // `--chamber-inert`, not `--chamber-line`: this tone colours the *core* of a
  // superseded or denied run, and the wireframe value is three shades off the
  // background — those verdicts would be a dot nobody can see. The wireframe
  // has its own token because it is a different job.
  inert: "--chamber-inert",
  bone: "--chamber-fg-muted",
};

export const STATUS_LABELS: Record<RunStatus, string> = {
  running: "running",
  clean: "clean",
  blocked_pending: "awaiting approval",
  blocked_unattended: "blocked",
  blocked_posted: "blocked",
  denied: "denied",
  error: "error",
  superseded: "superseded",
};

/**
 * The same statuses, for a legend that lists all of them at once.
 *
 * `blocked_unattended` and `blocked_posted` are both "blocked" on a badge,
 * where only one appears and the difference is on the pull request. Side by
 * side in a legend that reads as the same row printed twice, so here they say
 * which one decided: Cujo on its own authority, or a person who confirmed.
 */
export const STATUS_LEGEND: Record<RunStatus, string> = {
  ...STATUS_LABELS,
  blocked_unattended: "blocked, unattended",
  blocked_posted: "blocked, confirmed",
};

/** How a single check ended, which is what one segment of a sensor strip draws. */
export type CheckOutcome = "done" | "error" | "running" | "absent";

/**
 * `absent` is a fact and not a failure: a check that never appeared is what the
 * hard rule `check_missing` exists for, and the strip has to draw it as a gap
 * rather than as a segment that failed.
 */
export function checkOutcome(check: DigestCheck | undefined): CheckOutcome {
  if (!check) return "absent";
  return check.status;
}

/**
 * A check that reported is bone, not blue.
 *
 * Colouring `done` as a severity made the chamber a blue haze: four checks
 * report on almost every run, so the colour that meant "fine" was 80% of what
 * was drawn, and red had to compete with it instead of interrupting it. Bone
 * is the same restraint brand.md asks of amber, applied to the whole ramp — a
 * calm review is nearly colourless, and the eye goes straight to the one arm
 * that is not.
 *
 * A check still running is inert, not blue. Blue is a verdict in the chamber —
 * a clean run's core and an errored run's core — and giving it a second
 * meaning on an arm would make one hue say two things in a single drawing.
 * Inert is what "no measurement yet" already means, and the arm is not relying
 * on hue to say it: a running check is drawn at the shorter unmeasured length,
 * and its whole specimen breathes while the run is live.
 *
 * This map feeds the chamber alone. The record's sensor strip keeps its own
 * classes: it draws no cores, so blue is free there and carries the pulse.
 *
 * `absent` never reaches a renderer — an arm of length zero is not drawn, in
 * the scene or in the flat elevation — so its tone is what a gap would be
 * rather than something the eye is asked to read.
 */
export const OUTCOME_TONE: Record<CheckOutcome, Tone> = {
  done: "bone",
  error: "critical",
  running: "inert",
  absent: "inert",
};

/** The digest's checks, or an empty map for a run that never folded one. */
export function checksOf(run: RunSummary): Partial<Record<CheckName, DigestCheck>> {
  return run.digest?.checks ?? {};
}

/**
 * What the run *found*, as opposed to how its checks ended.
 *
 * `digest.findings` is a `Record<Severity, number>` and the board draws it in
 * three places — a specimen's marks, a record row, the rack's fifth panel. This
 * is the one place a severity becomes a tone, so those three cannot disagree
 * about which count is the dangerous one.
 *
 * `warn` is amber and not its own hue, per brand.md: the product emits three
 * severities and `warn` renders on the `high` ramp, which is the amber one.
 * That puts amber on a second thing in the chamber — a `blocked_pending` core,
 * the sweep, and now a warn mark — and it stays within the restraint the brand
 * asks for, because a warn mark is a two-pixel quad and a calm run has none.
 */
export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "critical",
  warn: "amber",
  info: "info",
};

/** Worst first, which is the order marks are strung and legends are listed. */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "warn", "info"];

/** What `digest.findings` is, named so the three readers can say it. */
export type FindingCounts = Record<Severity, number>;

/** Null when the run found nothing, which is a result and not a missing value. */
export function worstSeverity(counts: FindingCounts | undefined): Severity | null {
  if (!counts) return null;
  return SEVERITY_ORDER.find((severity) => (counts[severity] ?? 0) > 0) ?? null;
}

/**
 * One number to sort a record column by, and to scale a core with.
 *
 * Ranked rather than summed: a run with one critical outranks a run with nine
 * infos, and adding the counts would say the opposite. The gaps are wide enough
 * that no realistic number of a lower severity can climb past a higher one.
 */
export function findingWeight(counts: FindingCounts | undefined): number {
  if (!counts) return 0;
  return (counts.critical ?? 0) * 10_000 + (counts.warn ?? 0) * 100 + (counts.info ?? 0);
}

/** How many findings a run produced, across every severity. */
export function findingTotal(counts: FindingCounts | undefined): number {
  if (!counts) return 0;
  return SEVERITY_ORDER.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
}
