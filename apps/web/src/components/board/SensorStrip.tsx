import { CHECK_NAMES, type RunSummary } from "@/lib/api/types";
import { type CheckOutcome, OUTCOME_SPOKEN, checkOutcome, checksOf } from "@/lib/board/tone";

/**
 * Four segments, one per check, in `CHECK_NAMES` order.
 *
 * This replaces the single status pill on a record row. The pill said a run was
 * blocked; the strip says which check said so — the same information the
 * specimen's four arms carry, so a row and its specimen read alike.
 *
 * The four outcomes are drawn as four different things and never as shades of
 * one, because `absent` is not a weaker `error`: a check that never appeared is
 * what the hard rule `check_missing` exists for.
 */

/**
 * A check that reported is the plain foreground, not a severity colour: four
 * of these on nearly every row would otherwise make the colour that means
 * "fine" the loudest thing in the table. Colour is left for the one segment
 * that is not fine.
 */
export const SEGMENT: Record<CheckOutcome, string> = {
  done: "bg-fg",
  error: "bg-sev-critical",
  running: "animate-pulse bg-sev-live",
  absent: "bg-line",
};

/** The words, from the one place every drawing of a check takes them. */
export const SPOKEN = OUTCOME_SPOKEN;

export function SensorStrip({ run }: { run: RunSummary }) {
  const checks = checksOf(run);
  // No digest at all is not four checks that did nothing, so it says so rather
  // than drawing four empty segments.
  if (!run.digest) {
    return <span className="font-mono text-xs text-fg-muted">not folded</span>;
  }
  const spoken = CHECK_NAMES.map((name) => `${name} ${SPOKEN[checkOutcome(checks[name])]}`).join(
    ", ",
  );

  return (
    <span className="flex items-center gap-1" title={spoken}>
      <span className="sr-only">{spoken}</span>
      {CHECK_NAMES.map((name) => (
        <span
          key={name}
          aria-hidden="true"
          className={`h-3 w-2 rounded-[1px] ${SEGMENT[checkOutcome(checks[name])]}`}
        />
      ))}
    </span>
  );
}
