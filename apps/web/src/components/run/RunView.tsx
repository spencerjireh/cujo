"use client";

import { useRunStream } from "@/hooks/useRunStream";
import { runOptions } from "@/lib/api/queries";
import { gatedReviewPosted, reviewPosted } from "@/lib/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApproveBar } from "./ApproveBar";
import { CheckReports } from "./CheckReports";
import { ChecksTimeline } from "./ChecksTimeline";
import { FindingsList } from "./FindingsList";
import { ReviewPanel } from "./ReviewPanel";
import { RunHeader } from "./RunHeader";
import { RunProvenance } from "./RunProvenance";

/**
 * Timeline first: the lanes are the page's thesis, then the findings they
 * produced, then the review those findings justify, then the decision.
 */
export function RunView({ id }: { id: string }) {
  const { data: run, error } = useQuery(runOptions(id));
  const { streamFailed } = useRunStream(id, run?.status);
  /**
   * The lane a reader picked on the timeline, by check name.
   *
   * Here rather than in either section, because it is a fact about the page and
   * not about one part of it: the timeline says which check, and the reports
   * section is what opens and scrolls. The board says the same thing between
   * the chamber and the record, through a store — a store because those two are
   * not siblings. These are, so this is the state.
   *
   * A count rides with the name so that picking the same lane twice delivers
   * twice: the first click scrolls, and a reader who scrolls back up and clicks
   * it again means it again.
   */
  const [picked, setPicked] = useState<{ check: string; nonce: number } | null>(null);

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
      <ChecksTimeline
        checks={run.checks}
        findings={run.findings}
        setup={run.setup}
        onSelect={(check) => setPicked((was) => ({ check, nonce: (was?.nonce ?? 0) + 1 }))}
      />
      <FindingsList findings={run.findings} status={run.status} />
      {run.review ? (
        <ReviewPanel
          review={run.review}
          posted={reviewPosted(run)}
          checks={run.checks}
          findings={run.findings}
        />
      ) : null}
      {/*
        Both, when there are both. The advisory is already on the pull request
        while the accusation waits, and showing only one of them is how a human
        ends up confirming a body they never read.
      */}
      {run.gated_review ? (
        <ReviewPanel
          review={run.gated_review}
          posted={gatedReviewPosted(run)}
          advisoryStands={!!run.review && reviewPosted(run)}
          checks={run.checks}
          findings={run.findings}
        />
      ) : null}
      <CheckReports checks={run.checks} picked={picked} />
      {/* Last before the decision, and folded: what the run cost and what
          produced it are context for the verdict, never an argument for it,
          and they are the operator's context rather than the author's. */}
      <RunProvenance run={run} />
      <ApproveBar run={run} />
    </article>
  );
}
