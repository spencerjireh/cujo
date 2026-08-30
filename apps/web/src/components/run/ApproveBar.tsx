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
 * pointed at the other hostname. Decision 57 deleted that hostname, so there is
 * one panel and it is keyed only on what the board publishes: `status`, the
 * pull request it belongs to, and whether a review has posted. Not `approval`,
 * which is withheld, and not `approver`, which names a person.
 *
 * One line, and only while something is outstanding. It used to be a band of
 * three sentences pinned over the bottom of every run — including the ones
 * where nothing is being waited on, which is a permanent strip of the window
 * spent saying so. What the two commands *do* is a fact about the review being
 * held, so it is said under that review, where there is room for it; what is
 * left here is the state and the two words, which is what a pinned line is for.
 */
export function ApproveBar({ run }: { run: Run }) {
  if (run.status === "blocked_pending") return <WaitingOnAMaintainer run={run} />;
  return <ExplainWhyNot run={run} />;
}

function WaitingOnAMaintainer({ run }: { run: Run }) {
  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-raised px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="h-4 w-1 shrink-0 rounded-sm bg-accent-fill" aria-hidden="true" />
        {/* `flex-1` with a floor, so the commands sit at the far end of a wide
            bar and drop to their own line on a narrow one rather than being
            squeezed into a column beside three words. */}
        <p className="min-w-48 flex-1 text-sm">
          Waiting on a maintainer of{" "}
          <span className="font-mono text-xs">
            {run.repo} #{run.pr_number}
          </span>
        </p>
        <p className="font-mono text-xs text-fg-muted">
          reply <Command>/cujo confirm</Command> or <Command>/cujo dismiss</Command> on the pull
          request
        </p>
      </div>
    </div>
  );
}

/** One of the two words, set apart from the sentence it sits in. */
function Command({ children }: { children: string }) {
  return <span className="bg-bg px-1.5 py-0.5 text-fg">{children}</span>;
}

/**
 * Why there is nothing outstanding, rather than an absent control.
 *
 * In the flow of the page and not pinned to the bottom of the window: every
 * status below is a run that is over, so there is nothing for a reader to come
 * back to this line for once they have read it.
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
    <p className="border-t border-line pt-4 font-mono text-xs leading-relaxed text-fg-muted">
      {reason}
      {run.external_resume ? " This run was resumed from the harness console." : ""}
    </p>
  );
}
