import { SeverityBadge } from "@/components/SeverityBadge";
import { type Finding, type RunStatus, isLive } from "@/lib/api/types";

/**
 * `findings` arrives presorted critical-first and already merged with the
 * hard-rule hits, so this renders the order it is given rather than re-sorting.
 *
 * The empty state depends on the run status. A check that never reported only
 * becomes a finding at `turn.done`, so an empty list on a live run means "not
 * yet", not "nothing wrong" — and claiming a clean result while someone is
 * deciding whether to block a merge would be the worst place to overstate it.
 */
export function FindingsList({
  findings,
  status,
}: {
  findings: Finding[];
  status: RunStatus;
}) {
  if (findings.length === 0) {
    return (
      <section aria-label="Findings">
        <h2 className="mb-3 text-lg">Findings</h2>
        <p className="text-sm text-fg-muted">
          {isLive(status)
            ? "Nothing found so far. Checks that have not reported yet are still counted at the end of the run."
            : "Nothing to report. Every check ran and none of the hard rules tripped."}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Findings">
      <h2 className="mb-3 text-lg">
        Findings <span className="text-fg-muted">({findings.length})</span>
      </h2>
      <ul className="flex flex-col">
        {findings.map((finding) => (
          <li
            key={`${finding.check}-${finding.title}`}
            className="grid grid-cols-[5.5rem_1fr] items-start gap-3 border-t border-line py-3"
          >
            <SeverityBadge severity={finding.severity} />
            <div className="min-w-0">
              <p className="text-sm">{finding.title}</p>
              {finding.evidence ? (
                <p className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
                  {finding.evidence}
                </p>
              ) : null}
              <p className="mt-1 font-mono text-xs text-fg-muted">
                {finding.check}
                {finding.path ? ` · ${finding.path}${finding.line ? `:${finding.line}` : ""}` : ""}
                {finding.source === "hard_rule" ? " · hard rule" : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
