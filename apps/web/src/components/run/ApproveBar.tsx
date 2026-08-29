"use client";

import { usePlane } from "@/app/providers";
import { type Run, canDecide } from "@/lib/api/types";

/**
 * What a held review says, now that nothing here decides it.
 *
 * The decision moved to the pull request (decision 48): `/cujo confirm` from
 * somebody with repo write, recorded against their GitHub login. This panel is
 * what is left — a held review is a state the run sits in, sometimes for a long
 * time, and a reader looking at the evidence needs to know a person is being
 * waited on and which two words answer it.
 *
 * It is deliberately not a link to a button somewhere else. There is no button
 * anywhere: one gate, in one place, with one audit trail.
 */
export function ApproveBar({ run }: { run: Run }) {
  const { mode, adminBaseUrl } = usePlane();
  if (mode === "public") return <PointAtOperator run={run} adminBaseUrl={adminBaseUrl} />;
  if (!canDecide(run)) return <ExplainWhyNot run={run} />;

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
 * The public plane's counterpart. It says the run is waiting on a person and
 * where that happens. The link is open to anyone; Access decides who gets past
 * it, and an operator's email is what the decision is recorded against
 * (decision 28).
 */
function PointAtOperator({ run, adminBaseUrl }: { run: Run; adminBaseUrl: string }) {
  if (run.status !== "blocked_pending") return null;
  const href = adminBaseUrl ? `${adminBaseUrl}/runs/${encodeURIComponent(run.id)}` : null;
  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-raised px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-8 w-1 shrink-0 rounded-sm bg-accent-fill" aria-hidden="true" />
        <p className="min-w-48 flex-1 text-sm">
          This review is blocked and waiting on a human decision.{" "}
          <span className="text-fg-muted">
            {run.review
              ? "The observation is already on the pull request; only the accusation waits."
              : "Nothing reaches the pull request until then."}
          </span>
        </p>
        {href ? (
          <a
            href={href}
            className="rounded-md border border-line px-4 py-1.5 text-sm no-underline transition-colors hover:border-fg-muted"
          >
            Decide on cujo-admin
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Why the decision is unavailable, rather than an absent control. */
function ExplainWhyNot({ run }: { run: Run }) {
  const reason =
    run.status === "blocked_pending" && !run.approval
      ? "This run paused on a thread that is not allowed to post reviews, so it cannot be approved."
      : run.status === "superseded"
        ? "A newer commit replaced this run. Decide on the newest run for this pull request."
        : run.status === "blocked_unattended"
          ? "Cujo blocked this merge on its own authority: the finding is a correctness one, so nothing was held for a human."
          : run.status === "blocked_posted"
            ? `Approved${run.approver ? ` by ${run.approver}` : ""}. The blocking review is on the pull request.`
            : run.status === "denied"
              ? // A denied run no longer means an untouched pull request. On the
                // malice path the advisory posted before the gate, and "no
                // review was posted" would send a reader looking for something
                // that is plainly there.
                `Denied${run.approver ? ` by ${run.approver}` : ""}. ${
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
