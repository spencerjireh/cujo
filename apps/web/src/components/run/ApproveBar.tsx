"use client";

import type { Run } from "@/lib/api/types";

/**
 * What a held review says, now that nothing here decides it.
 *
 * The decision moved to the pull request (decision 49): `/cujo confirm` from
 * somebody with repo write, recorded against their GitHub login. This panel is
 * what is left — a held review is a state the run sits in, sometimes for a long
 * time, and a reader looking at the evidence needs to know a person is being
 * waited on and which two words answer it.
 *
 * It is deliberately not a link to a button somewhere else. There is no button
 * anywhere: one gate, in one place, with one audit trail.
 *
 * There used to be two versions of this, one per plane, and the public one
 * pointed at the other hostname. Decision 54 deleted that hostname, so there is
 * one panel and it is keyed only on what the board publishes: `status`, the
 * pull request it belongs to, and whether a review has posted. Not `approval`,
 * which is withheld, and not `approver`, which names a person.
 */
export function ApproveBar({ run }: { run: Run }) {
  if (run.status === "blocked_pending") return <WaitingOnAMaintainer run={run} />;
  return <ExplainWhyNot run={run} />;
}

function WaitingOnAMaintainer({ run }: { run: Run }) {
  // Keyed on the held review, never on `run.review`: `run.review` is what
  // already posted, so reading the tool off it would describe the advisory
  // while a human is being asked about the accusation.
  const gated = !!run.gated_review;
  const target = `${run.repo} #${run.pr_number}`;

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-raised px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-8 w-1 shrink-0 rounded-sm bg-accent-fill" aria-hidden="true" />
        <p className="min-w-48 flex-1 text-sm">
          {gated
            ? `This run is waiting on a maintainer of ${target}. Confirming posts the held review as REQUEST_CHANGES and holds the merge.`
            : `This run is waiting on a maintainer of ${target}.`}{" "}
          <span className="text-fg-muted">
            {gated && run.review
              ? "The advisory review is already on the pull request; dismissing leaves it standing and posts nothing more."
              : "Dismissing ends the run without posting it."}
          </span>
        </p>
        <p className="font-mono text-xs text-fg-muted">
          Reply <span className="text-fg">/cujo confirm</span> or{" "}
          <span className="text-fg">/cujo dismiss</span> on the pull request.
        </p>
      </div>
    </div>
  );
}

/**
 * Why there is nothing outstanding, rather than an absent control.
 *
 * None of these name the person who decided. `approver` is withheld by the
 * serializer and the confirming comment is on the pull request, which is a
 * better place to read a name than a board that is trying not to publish one.
 */
function ExplainWhyNot({ run }: { run: Run }) {
  const reason =
    run.status === "superseded"
      ? "A newer commit replaced this run. The newest run for this pull request is the live one."
      : run.status === "blocked_unattended"
        ? "Cujo blocked this merge on its own authority: the finding is a correctness one, so nothing was held for a human."
        : run.status === "blocked_posted"
          ? "Confirmed on the pull request. The blocking review is posted."
          : run.status === "denied"
            ? // A denied run no longer means an untouched pull request. On the
              // malice path the advisory posted before the gate, and "no review
              // was posted" would send a reader looking for something that is
              // plainly there.
              `Dismissed on the pull request. ${
                run.review
                  ? "The accusation was not posted; the observation already on the pull request stands."
                  : "No review was posted."
              }`
            : run.status === "running"
              ? "Still running. Nothing to decide yet."
              : null;

  if (!reason) return null;

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-raised px-4 py-3">
      <p className="text-sm text-fg-muted">
        {reason}
        {run.external_resume ? " This run was resumed from the harness console." : ""}
      </p>
    </div>
  );
}
