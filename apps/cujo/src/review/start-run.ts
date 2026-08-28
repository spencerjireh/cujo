/**
 * Turning a claimed run into a running turn (spec Contract 1, step 2).
 *
 * Split from the webhook route because none of it is HTTP. The route's job
 * ends when the run row is claimed; from there this reads the PR, decides
 * whether the head is still current, supersedes anything older, and starts the
 * turn. It runs in the background so GitHub's ten-second delivery timeout is
 * never in play, which is also why nothing here can answer the request.
 */

import type { GitHubReader } from "../clients/github";
import type { RunStore } from "../store";
import { buildTurnMessage } from "./agent-spec";
import type { Runner } from "./runner.service";
import type { RunRecord } from "./types";

export interface StartRunDeps {
  github: GitHubReader;
  store: RunStore;
  runner: Runner;
  /** Test hook: called when the background preparation of a run has settled. */
  onSettled?: (runId: string) => void;
}

export async function startRun(deps: StartRunDeps, run: RunRecord): Promise<void> {
  try {
    if (await deps.github.alreadyReviewed(run.repo, run.prNumber, run.headSha)) {
      // Release the claim so nothing shows a run that never happened.
      deps.store.deleteRun(run.id);
      return;
    }
    const pr = await deps.github.pullRequest(run.repo, run.prNumber);
    // The only place the title is ever read. A Discord card names the PR
    // with it (Contract 7) and falls back to `owner/name #7` without it.
    deps.store.putRunPrTitle(run.id, pr.title);
    // Delivery order is not commit order: a delayed delivery for an older
    // head must not replace the run for the head GitHub reports now.
    if (pr.headSha !== run.headSha) {
      await deps.runner.supersede(run.id);
      return;
    }
    // This is the current head, so a review of any older head is stale.
    const scope = { repo: run.repo, prNumber: run.prNumber };
    for (const old of deps.store.listUnfinishedRuns(scope)) {
      if (old.id !== run.id) await deps.runner.supersede(old.id);
    }
    await deps.runner.start(run, buildTurnMessage(pr));
  } catch (error) {
    // The run ends in error with no turn, which lets a redelivery re-claim
    // the head (RunStore.createRun) instead of being refused as a duplicate.
    console.error(`run ${run.id}: could not prepare`, error);
    deps.runner.fail(run.id, `could not prepare run: ${String(error)}`);
  } finally {
    deps.onSettled?.(run.id);
  }
}
