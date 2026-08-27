import { SeverityBadge } from "@/components/SeverityBadge";
import type { Finding } from "@/lib/api/types";

/**
 * `findings` arrives presorted critical-first and already merged with the
 * hard-rule hits, so this renders the order it is given rather than re-sorting.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <section aria-label="Findings">
        <h2 className="mb-3 text-lg">Findings</h2>
        <p className="text-sm text-fg-muted">
          Nothing to report. Every check ran and none of the hard rules tripped.
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
