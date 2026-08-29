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

import type { CheckName, DigestCheck, RunStatus, RunSummary } from "@/lib/api/types";

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
  inert: "--chamber-line",
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
 */
export const OUTCOME_TONE: Record<CheckOutcome, Tone> = {
  done: "bone",
  error: "critical",
  running: "info",
  absent: "inert",
};

/** The digest's checks, or an empty map for a run that never folded one. */
export function checksOf(run: RunSummary): Partial<Record<CheckName, DigestCheck>> {
  return run.digest?.checks ?? {};
}
