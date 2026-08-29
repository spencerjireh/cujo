/**
 * Dismiss the bot's own stale REQUEST_CHANGES reviews when a new run on the
 * same PR completes clean (decision 52).
 *
 * Evidence-based: the trigger is `projection.status === "clean"`, which by
 * definition means zero critical findings remain. Only reviews from older
 * commits are touched — a review on the current head is never dismissed.
 *
 * A head-freshness guard prevents a race where the PR advances while this
 * fire-and-forget task is in flight: a newer head's blocking review must
 * not be dismissed by a clean run that preceded it.
 */

import type { Logger } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { Projection, RunRecord } from "./types";

export interface DismissStaleReviewsDeps {
  github: Pick<GitHubReader, "listBotReviews" | "dismissReview" | "pullRequestHead">;
  log: Logger;
}

export async function dismissStaleReviews(
  deps: DismissStaleReviewsDeps,
  run: RunRecord,
  projection: Projection,
): Promise<void> {
  if (projection.status !== "clean") return;

  const prHead = await deps.github.pullRequestHead(run.repo, run.prNumber);
  if (!prHead || prHead.headSha !== run.headSha) {
    deps.log.info("review.stale.skipped", { reason: "head_moved" });
    return;
  }

  const reviews = await deps.github.listBotReviews(run.repo, run.prNumber);
  const stale = reviews.filter(
    (r) => r.state === "CHANGES_REQUESTED" && r.commitId !== run.headSha,
  );
  if (stale.length === 0) return;

  const message = `Superseded by a clean run on ${run.headSha.slice(0, 7)}.`;
  for (const review of stale) {
    try {
      await deps.github.dismissReview(run.repo, run.prNumber, review.id, message);
      deps.log.info("review.stale.dismissed", {
        review_id: review.id,
        head_sha: run.headSha,
      });
    } catch (error) {
      deps.log.warn("review.stale.dismiss.failed", {
        review_id: review.id,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
