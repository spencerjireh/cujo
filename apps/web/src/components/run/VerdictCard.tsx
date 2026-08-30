import { StatusBadge } from "@/components/StatusBadge";
import { type Run, gatedReviewPosted, reviewPosted } from "@/lib/api/types";
import { SEVERITY_ORDER, SEVERITY_TONE, TONE_BG, TONE_TEXT } from "@/lib/board/tone";
import { prUrl } from "@/lib/format";

/**
 * The verdict, before anything else on the page.
 *
 * Most readers arrive here from a link in a GitHub review, holding one
 * question: what did this run decide, and how bad was it. The header used to
 * answer that in a badge the size of a footnote beside the title, and the
 * count of what was found lived a screen further down in the findings list.
 * This is the same two facts, first and at a size that says they are the
 * point: the status, the findings by severity, and the way back to the review
 * on GitHub when one was posted.
 *
 * Critical is always stated, even at zero. A card that lists two warnings and
 * says nothing about critical leaves a reader to wonder whether none was found
 * or none was counted; "0 critical" closes the question.
 *
 * While the run is live the counts are not yet a result. A check that never
 * reported only becomes a finding at the end of the turn, so a card that said
 * "0 critical" over a running run would be claiming a clean result before the
 * run had one.
 */
export function VerdictCard({ run }: { run: Run }) {
  // `running` and not `isLive`: a run awaiting approval is live in the sense
  // that its turn is paused, but its checks have all reported and its
  // findings are the reason it is waiting. Those are the counts to show.
  const live = run.status === "running";
  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: run.findings.filter((finding) => finding.severity === severity).length,
  }));
  const posted = reviewPosted(run) || gatedReviewPosted(run);

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-line bg-bg-raised px-4 py-3"
      aria-label="Verdict"
    >
      {/* `StatusBadge` has one size, the one every row and card on the board
          shares. Here it is the headline, so the wrapper scales the badge it
          contains rather than the badge growing a prop nobody else needs. */}
      <span className="[&>span]:px-3 [&>span]:py-1 [&>span]:text-sm">
        <StatusBadge status={run.status} />
      </span>
      {live ? (
        <span className="font-mono text-xs text-fg-muted">still running</span>
      ) : (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Findings by severity">
          {counts.map(({ severity, count }) => {
            // Zero is stated for critical and dropped for the rest: the
            // absence of a critical finding is the fact a reader came for,
            // and "0 info" is noise.
            if (count === 0 && severity !== "critical") return null;
            const tone = SEVERITY_TONE[severity];
            const chip =
              count === 0 ? "bg-bg text-fg-muted" : `${TONE_TEXT[tone]} ${TONE_BG[tone]}`;
            return (
              <li
                key={severity}
                className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${chip}`}
              >
                {count} {severity}
              </li>
            );
          })}
        </ul>
      )}
      {posted ? (
        <a
          href={prUrl(run.repo, run.pr_number)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-mono text-xs text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          Read the review on GitHub
        </a>
      ) : null}
    </div>
  );
}
