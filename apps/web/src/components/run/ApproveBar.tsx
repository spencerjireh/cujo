"use client";

import { usePlane } from "@/app/providers";
import { ApiError, approveRun } from "@/lib/api/client";
import { runKeys } from "@/lib/api/keys";
import { type Run, canDecide } from "@/lib/api/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * The decision surface.
 *
 * It is a persistent bar rather than a modal: a held review is a state the run
 * sits in, sometimes for a long time, and the page above it is the evidence the
 * operator is deciding on. Naming the exact consequence in the bar is the
 * confirmation step — a dialog on top of it would only add a click.
 *
 * There is no optimistic update. A 409 is a normal outcome here (the run was
 * superseded, someone resumed it from the harness console, a double click), and
 * the stream delivers the real status a moment later anyway.
 *
 * On the public plane there is no control at all. Hiding it is not what
 * protects anything — `apps/cujo` serves no approve route there (decision 34);
 * what this renders instead is where to go, since an anonymous visitor looking
 * at a held review otherwise has no way to know a decision is pending.
 */
export function ApproveBar({ run }: { run: Run }) {
  const { mode, adminBaseUrl } = usePlane();
  const queryClient = useQueryClient();
  const decidable = canDecide(run);

  // Every hook before any early return. The plane cannot change under a mounted
  // tree — it is fixed per request by the hostname — but a conditional hook is
  // wrong whether or not the condition ever moves, and the next person to add a
  // branch above it would inherit a real bug.
  const mutation = useMutation({
    mutationFn: (decision: "allow" | "deny") => approveRun(run.id, decision),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.detail("operator", run.id) });
      void queryClient.invalidateQueries({ queryKey: runKeys.list("operator") });
    },
  });

  if (mode === "public") return <PointAtOperator run={run} adminBaseUrl={adminBaseUrl} />;
  if (!decidable) return <ExplainWhyNot run={run} />;

  const blocking = run.review?.tool === "post_blocking_review";
  const target = `${run.repo} #${run.pr_number}`;

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-raised px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-8 w-1 shrink-0 rounded-sm bg-accent-fill" aria-hidden="true" />
        <p className="min-w-48 flex-1 text-sm">
          {blocking
            ? `Approving posts a blocking review on ${target} and holds the merge.`
            : `Approving posts this review on ${target}.`}{" "}
          <span className="text-fg-muted">Denying ends the run without posting it.</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("deny")}
            className="rounded-md border border-line px-4 py-1.5 text-sm transition-colors hover:border-fg-muted disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("allow")}
            className="rounded-md bg-accent-fill px-4 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Working…" : "Approve"}
          </button>
        </div>
      </div>
      {mutation.error ? (
        <p className="mt-2 font-mono text-xs text-sev-critical">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : "The decision could not be recorded."}{" "}
          Reload to see where the run stands.
        </p>
      ) : null}
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
          <span className="text-fg-muted">Nothing reaches the pull request until then.</span>
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
        : run.status === "blocked_posted"
          ? `Approved${run.approver ? ` by ${run.approver}` : ""}. The blocking review is on the pull request.`
          : run.status === "denied"
            ? `Denied${run.approver ? ` by ${run.approver}` : ""}. No review was posted.`
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
