"use client";

import { useRunStream } from "@/hooks/useRunStream";
import { runOptions } from "@/lib/api/queries";
import { reviewPosted } from "@/lib/api/types";
import { useQuery } from "@tanstack/react-query";
import { ApproveBar } from "./ApproveBar";
import { CheckReports } from "./CheckReports";
import { ChecksTimeline } from "./ChecksTimeline";
import { FindingsList } from "./FindingsList";
import { ReviewPanel } from "./ReviewPanel";
import { RunHeader } from "./RunHeader";

/**
 * Timeline first: the lanes are the page's thesis, then the findings they
 * produced, then the review those findings justify, then the decision.
 */
export function RunView({ id }: { id: string }) {
  const { data: run, error } = useQuery(runOptions(id));
  useRunStream(id, run?.status);

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
      <ChecksTimeline checks={run.checks} findings={run.findings} />
      <FindingsList findings={run.findings} status={run.status} />
      {run.review ? <ReviewPanel review={run.review} posted={reviewPosted(run)} /> : null}
      <CheckReports checks={run.checks} />
      <ApproveBar run={run} />
    </article>
  );
}
