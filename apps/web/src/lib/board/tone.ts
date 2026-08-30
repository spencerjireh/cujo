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
import { duration } from "@/lib/format";

/**
 * Six tones, not eight statuses. Several statuses are the same claim about the
 * pull request — `blocked_unattended` and `blocked_posted` differ in who
 * decided, which the *label* says and the colour does not have to. `live` is
 * green and is the one tone that is not a verdict: it says the thing is still
 * executing, and it was inert grey until decision 94, when a running run on a
 * board full of verdicts was the one star nobody could find.
 */
export type Tone = "critical" | "amber" | "info" | "inert" | "bone" | "live";

const STATUS_TONE: Record<RunStatus, Tone> = {
  running: "live",
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
  live: "text-sev-live",
};

export const TONE_BG: Record<Tone, string> = {
  critical: "bg-sev-critical-bg",
  amber: "bg-sev-high-bg",
  info: "bg-sev-info-bg",
  inert: "bg-sev-low-bg",
  bone: "bg-bg-raised",
  live: "bg-sev-live-bg",
};

/** A solid fill in the tone itself, for a bar rather than a badge. */
export const TONE_FILL: Record<Tone, string> = {
  critical: "bg-sev-critical",
  amber: "bg-sev-high",
  info: "bg-sev-info",
  inert: "bg-fg-muted",
  bone: "bg-fg",
  live: "bg-sev-live",
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
  live: "--chamber-live",
};

/**
 * The same tones on the page's own ground, for the one specimen drawn outside
 * the chamber: the run page's, which sits on `--bg` and follows the reader's
 * theme (decision 95). Bone is the page's foreground, not the chamber's muted
 * one, because on a light page muted bone is a ring nobody can see.
 */
export const TONE_PAGE_VAR: Record<Tone, string> = {
  critical: "--sev-critical",
  amber: "--sev-high",
  info: "--sev-info",
  inert: "--sev-low",
  bone: "--fg",
  live: "--sev-live",
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
 * A check still running is live green, and so is a running run's core. It
 * was inert: blue is a verdict in the chamber and could not be spent on an
 * arm, and grey was what "no measurement yet" already meant. Grey was also
 * invisible — the one star on the board that was doing something was the one
 * a reader could not find — so decision 94 gave running its own hue, one that
 * is not on the severity ramp and so cannot be read as a verdict. The record's
 * sensor strip and the rack's segment use the same token, so the four
 * drawings of a running check agree.
 *
 * `absent` never reaches a renderer — an arm of length zero is not drawn, in
 * the scene or in the flat elevation — so its tone is what a gap would be
 * rather than something the eye is asked to read.
 */
export const OUTCOME_TONE: Record<CheckOutcome, Tone> = {
  done: "bone",
  error: "critical",
  running: "live",
  absent: "inert",
};

/** The digest's checks, or an empty map for a run that never folded one. */
export function checksOf(run: RunSummary): Partial<Record<CheckName, DigestCheck>> {
  return run.digest?.checks ?? {};
}

/** What one segment of a sensor strip, or one ring, says when spoken. */
export const OUTCOME_SPOKEN: Record<CheckOutcome, string> = {
  done: "reported",
  error: "errored",
  running: "running",
  absent: "did not run",
};

/**
 * One check, in words: how it ended, how long it took, and how much of that
 * was the sandbox executing the pull request. The same sentence the chamber's
 * callout, the record's tooltip and the record's expanded row all speak, so
 * the three cannot describe one ring three ways. Pure, and given the check
 * rather than the run, so the callout can call it from a specimen's bar.
 */
export function checkSentence(
  name: string,
  check:
    | { status: CheckOutcome | DigestCheck["status"]; ms: number | null; sandboxMs: number | null }
    | undefined,
): string {
  const outcome = check ? check.status : "absent";
  const parts = [OUTCOME_SPOKEN[outcome]];
  if (check?.ms != null) {
    const took = duration(new Date(0).toISOString(), new Date(check.ms).toISOString());
    if (took) parts.push(took);
    if (check.sandboxMs != null && check.ms > 0) {
      parts.push(`${Math.round((check.sandboxMs / check.ms) * 100)}% in the sandbox`);
    }
  }
  return `${name}: ${parts.join(", ")}`;
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
 * Orders two runs by what they found, worst severity first.
 *
 * A comparator and not a weight. Folding the three counts into one number —
 * `critical * 10_000 + warn * 100 + info` — is the obvious way to make the
 * record column sortable, and it is wrong: a hundred and one warns outrank a
 * critical, because the counts come off an unbounded findings array and no
 * fixed multiplier can be large enough. Comparing rank by rank cannot invert at
 * any count.
 *
 * A run that folded no digest sorts below a run that found nothing. Those are
 * different claims — one is the absence of a measurement, the other is a
 * result — and the column already draws them differently.
 */
export function compareFindings(
  a: FindingCounts | null | undefined,
  b: FindingCounts | null | undefined,
): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
  for (const severity of SEVERITY_ORDER) {
    const difference = (a[severity] ?? 0) - (b[severity] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** How many findings a run produced, across every severity. */
export function findingTotal(counts: FindingCounts | undefined): number {
  if (!counts) return 0;
  return SEVERITY_ORDER.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
}
