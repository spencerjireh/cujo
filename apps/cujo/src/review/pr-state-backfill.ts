/**
 * Fills in whether each pull request with runs is still open (decision 179).
 *
 * The `closed` and `reopened` webhooks are the fast path; this is for the
 * pull requests that closed before cujo listened for them, which is every
 * one on the first deploy, and for a delivery that never arrived. Run once
 * at boot. Sequential, as the visibility sweep is, so it never bursts the
 * App's rate limit; a pull request GitHub will not answer for stays unknown,
 * and unknown reads as open.
 */

import type { Logger } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { PullRequestStore } from "../store/pull-requests";

export interface PrStateBackfillDeps {
  log: Logger;
  github: Pick<GitHubReader, "pullRequestState">;
  pullRequests: Pick<PullRequestStore, "unknownWithRuns" | "set">;
  now?: () => Date;
}

export async function backfillPullRequestStates(
  deps: PrStateBackfillDeps,
): Promise<{ checked: number; recorded: number; unknown: number }> {
  const now = deps.now ?? (() => new Date());
  const pending = deps.pullRequests.unknownWithRuns();
  let recorded = 0;
  let unknown = 0;
  for (const key of pending) {
    const answer = await deps.github.pullRequestState(key.repo, key.prNumber);
    if (!answer) {
      unknown += 1;
      continue;
    }
    if (deps.pullRequests.set(key, answer.state, answer.closedAt, now())) recorded += 1;
  }
  if (pending.length > 0) {
    deps.log.info("pr_state.swept", { active: pending.length, count: recorded, attempts: unknown });
  }
  return { checked: pending.length, recorded, unknown };
}
