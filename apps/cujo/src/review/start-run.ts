/**
 * Turning a claimed run into a running turn (spec Contract 1, step 2).
 *
 * Split from the webhook route because none of it is HTTP. The route's job
 * ends when the run row is claimed; from there this reads the PR, decides
 * whether the head is still current, supersedes anything older, and starts the
 * turn. It runs in the background so GitHub's ten-second delivery timeout is
 * never in play, which is also why nothing here can answer the request.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { RunStore } from "../store";
import { buildTurnMessage } from "./agent-spec";
import type { Runner } from "./runner.service";
import type { RunRecord } from "./types";

export interface StartRunDeps {
  github: GitHubReader;
  store: RunStore;
  runner: Runner;
  /**
   * The run id to name in the review, or `""` when the review should carry no
   * link (decision 36). Injected rather than read from `Config` here, so
   * `review/` keeps taking only what it uses and the rule stays in one place.
   */
  reviewRunId: (run: RunRecord) => string;
  /** The process logger; every run binds a child of it (decision 37). */
  log: Logger;
  /**
   * The pull request's own acknowledgement (decision 38), called once this run
   * is known to be the one worth starting. Both guards below have to have
   * passed first, and for the same underlying reason — one pull request has
   * one reaction, so only a run that will go on to produce a status may touch
   * it. A head the bot already reviewed is deleted and never reaches a status;
   * a stale delivery is superseded and its `superseded` writes nothing, so an
   * eye placed before either check would sit on the pull request forever, over
   * the top of a newer run's finished verdict.
   */
  onClaimed?: (run: RunRecord) => void;
  /** Test hook: called when the background preparation of a run has settled. */
  onSettled?: (runId: string) => void;
}

/**
 * Everything this run will log, bound once.
 *
 * `ray` is the delivery that claimed the run, not the request that is already
 * over: this function runs after the webhook answered 202, and `rehydrate`,
 * the poll timer and `approve` have no request at all. Persisting the delivery
 * on the row (decision 37) is what lets all four agree.
 */
export function runLogger(log: Logger, run: RunRecord): Logger {
  return log.child({
    run_id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    ...(run.deliveryId ? { ray: run.deliveryId, delivery_id: run.deliveryId } : {}),
  });
}

export interface StartRunOptions {
  /**
   * Skip the already-reviewed guard, because somebody asked for this on
   * purpose. Set only by `/cujo review`, whose whole point is a second look at
   * a head Cujo has usually already reviewed. Nothing else may set it: the
   * guard is what stops a redelivery reviewing the same commit twice.
   */
  force?: boolean;
}

export async function startRun(
  deps: StartRunDeps,
  run: RunRecord,
  options: StartRunOptions = {},
): Promise<void> {
  const log = runLogger(deps.log, run);
  try {
    if (
      !options.force &&
      (await deps.github.alreadyReviewed(run.repo, run.prNumber, run.headSha))
    ) {
      // Silent until now, and it deletes a run: without a line, a PR that
      // simply never gets reviewed again looks identical to one that was
      // never delivered.
      log.info("run.skipped", { reason: "already_reviewed" });
      deps.store.deleteRun(run.id);
      return;
    }
    const pr = await deps.github.pullRequest(run.repo, run.prNumber);
    // The only place the title and the author are ever read. A Discord card
    // and a run page name the pull request and the person who opened it with
    // them (Contract 7, decision 55); both fall back to `owner/name #7` and no
    // author at all without them, which is what a run claimed before these
    // were stored still shows.
    deps.store.putRunPrMeta(run.id, {
      title: pr.title,
      authorLogin: pr.authorLogin,
      authorId: pr.authorId,
    });
    // Delivery order is not commit order: a delayed delivery for an older
    // head must not replace the run for the head GitHub reports now.
    if (pr.headSha !== run.headSha) {
      // Also silent until now. Delivery order is not commit order, so this
      // is a normal outcome — but indistinguishable from a lost run without
      // a line saying which head GitHub actually reports.
      log.info("run.superseded", { reason: "stale_head", to: pr.headSha });
      await deps.runner.supersede(run.id);
      return;
    }
    // GitHub agrees this is the current head, so this run is the one that
    // owns the pull request's reaction. Everything from here ends in a status
    // the reaction can follow, the `catch` below included.
    deps.onClaimed?.(run);
    // This is the current head, so a review of any older head is stale.
    const scope = { repo: run.repo, prNumber: run.prNumber };
    for (const old of deps.store.listUnfinishedRuns(scope)) {
      if (old.id !== run.id) {
        // The older run's own logger, not this one's with the id swapped.
        // Two mistakes are available here and the second is the subtle one: a
        // call-site `run_id` is ignored outright, because a bound field beats
        // it; and rebinding only `run_id` files the event under the old run
        // while still carrying *this* run's head, ray and delivery — a line
        // that is worse than silence, because it reads as fact.
        runLogger(deps.log, old).info("run.superseded", { reason: "newer_head", to: run.id });
        await deps.runner.supersede(old.id);
      }
    }
    // No line here: `Runner.start` emits run.turn.started once TrueForge has
    // returned the turn id, which is both the honest moment and the one that
    // can carry turn_id. Announcing it here as well produced two events per
    // start — and, when the start failed, a run.turn.started immediately
    // followed by run.turn.start.failed, describing a turn that never was.
    await deps.runner.start(run, buildTurnMessage(pr, deps.reviewRunId(run)));
  } catch (error) {
    // The run ends in error with no turn, which lets a redelivery re-claim
    // the head (RunStore.createRun) instead of being refused as a duplicate.
    log.error("run.prepare.failed", errorFields(error));
    deps.runner.fail(run.id, `could not prepare run: ${String(error)}`);
  } finally {
    deps.onSettled?.(run.id);
  }
}
