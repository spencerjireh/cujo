import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import type { OwnerRunSummary as RunSummary } from "@/lib/api/types";
import { SEVERITY_ORDER } from "@/lib/board/tone";
import { isClosed } from "@/lib/owner/activity";
import Link from "next/link";

const COUNT_TONE = {
  critical: "text-sev-critical",
  warn: "text-sev-high",
  info: "text-sev-info",
} as const;

/** The finding counts a run's digest carries, nonzero ones only. */
function FindingCounts({ run }: { run: RunSummary }) {
  const counts = run.digest?.findings;
  const shown = counts ? SEVERITY_ORDER.filter((severity) => counts[severity] > 0) : [];
  if (!counts || shown.length === 0) return <span className="text-fg-muted">None</span>;
  return (
    <span className="flex flex-wrap gap-x-3 font-mono text-xs">
      {shown.map((severity) => (
        <span key={severity} className={COUNT_TONE[severity]}>
          {counts[severity]} {severity}
        </span>
      ))}
    </span>
  );
}

/**
 * Runs as a table with fixed columns (decision 175), so a status or a count
 * lines up down the page whatever the title's length. The repository column
 * is dropped on a repository's own page, where it would say one thing on
 * every row. A merged or closed pull request says so beside its number
 * (decision 179), so a `blocked` row reads as history and not as work.
 */
export function RunTable({
  runs,
  showRepository = true,
}: {
  runs: RunSummary[];
  showRepository?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm md:min-w-[40rem]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Pull request
            </th>
            {showRepository ? (
              <th scope="col" className="hidden py-2 pr-4 font-medium md:table-cell">
                Repository
              </th>
            ) : null}
            <th scope="col" className="w-28 py-2 pr-4 font-medium">
              Result
            </th>
            <th scope="col" className="hidden w-40 py-2 pr-4 font-medium sm:table-cell">
              Findings
            </th>
            <th scope="col" className="hidden w-32 py-2 font-medium sm:table-cell">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-line align-top">
              <td className="py-2.5 pr-4">
                <Link
                  href={`/runs/${run.id}`}
                  className="text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {run.pr_title ?? `Pull request #${run.pr_number}`}
                </Link>
                <span className="ml-2 font-mono text-xs text-fg-muted">#{run.pr_number}</span>
                {isClosed(run) ? (
                  <span className="ml-2 rounded border border-line px-1.5 py-px text-xs text-fg-muted">
                    {run.pr_state}
                  </span>
                ) : null}
              </td>
              {showRepository ? (
                <td className="hidden py-2.5 pr-4 font-mono text-xs text-fg-muted md:table-cell">
                  {run.repo}
                </td>
              ) : null}
              <td className="py-2.5 pr-4">
                <StatusBadge status={run.status} />
              </td>
              <td className="hidden py-2.5 pr-4 sm:table-cell">
                <FindingCounts run={run} />
              </td>
              <td className="hidden py-2.5 text-fg-muted sm:table-cell">
                <RelativeTime iso={run.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
