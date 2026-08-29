"use client";

import { useRunStream } from "@/hooks/useRunStream";
import { runOptions } from "@/lib/api/queries";
import { gatedReviewPosted, reviewPosted } from "@/lib/api/types";
import { useQuery } from "@tanstack/react-query";
import { ApproveBar } from "./ApproveBar";
import { CheckReports } from "./CheckReports";
import { ChecksTimeline } from "./ChecksTimeline";
import { FindingsList } from "./FindingsList";
import { ReviewPanel } from "./ReviewPanel";
import { RunHeader } from "./RunHeader";
import { RunLedger } from "./RunLedger";

/**
 * Timeline first: the lanes are the page's thesis, then the findings they
 * produced, then the review those findings justify, then the decision.
 */
export function RunView({ id }: { id: string }) {
  const { data: run, error } = useQuery(runOptions(id));
  const { streamFailed } = useRunStream(id, run?.status);

  if (error) {
    return (
      <p className="text-sm text-sev-critical">
        This run could not be loaded. It may have been removed, or the API is unreachable.
      </p>
    );
  }
  if (!run) return <p className="text-sm text-fg-muted">Loading the run…</p>;

  return (
    <article className="flex flex-col gap-10 pb-4">
      <RunHeader run={run} />
      {streamFailed ? (
        <p className="-mt-6 text-xs text-fg-muted">
          Live updates are unavailable right now. Reload to see the latest.
        </p>
      ) : null}
      <ChecksTimeline checks={run.checks} findings={run.findings} />
      <FindingsList findings={run.findings} status={run.status} />
      {run.review ? <ReviewPanel review={run.review} posted={reviewPosted(run)} /> : null}
      {/*
        Both, when there are both. The advisory is already on the pull request
        while the accusation waits, and showing only one of them is how a human
        ends up confirming a body they never read.
      */}
      {run.gated_review ? (
        <ReviewPanel review={run.gated_review} posted={gatedReviewPosted(run)} />
      ) : null}
      <CheckReports checks={run.checks} />
      {/* Last of the evidence, before the decision: what the run cost is
          context for the verdict and never an argument for it. Renders
          nothing at all on a run that carries no record of it. */}
      <RunLedger usage={run.usage} />
      <ApproveBar run={run} />
    </article>
  );
}
