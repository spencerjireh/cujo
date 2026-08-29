import type { RunStatus } from "@/lib/api/types";
import { STATUS_LABELS, TONE_BG, TONE_TEXT, statusTone } from "@/lib/board/tone";

/**
 * Status carries meaning beyond colour, so each one is spelled out rather than
 * encoded as a dot: a reader scanning a page needs to tell `blocked_posted`
 * from `blocked_pending` at a glance.
 *
 * The colour and the words come from `lib/board/tone`, which the chamber's
 * specimens and the record's rows also read. A run drawn three ways on one page
 * must not be three different colours.
 */
export function StatusBadge({ status }: { status: RunStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${TONE_TEXT[tone]} ${TONE_BG[tone]}`}
    >
      {status === "running" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {STATUS_LABELS[status]}
    </span>
  );
}
