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
import type { DetonationCacheStore } from "../store/detonations";
import type { RepositorySettingsStore } from "../store/repository-settings";
import { buildDiffTurnMessage, buildTurnMessage, manifestChanged } from "./agent-spec";
import { lookupCachedDetonations } from "./detonation-cache";
import { readInstructions } from "./instructions";
import { resolveMode } from "./mode";
import { type OcrShadowDeps, shadowReview } from "./ocr-shadow";
import { type PrepareCaps, prepareReviewPackage } from "./prepare";
import type { Runner } from "./runner.service";
import { addedSpecifiers } from "./specifiers";
import type { ReviewMode, RunRecord } from "./types";

/**
 * What the diff review needs that the sandbox review does not (Contract 11).
 * Optional on `StartRunDeps` so that a composition without it — every test
 * that predates the diff review — starts every run as a sandbox run, which
 * is what those tests assert.
 */
export interface DiffReviewDeps {
  /** `CUJO_REVIEW_MODE`: the mode when the repository declares none. */
  deployDefault: ReviewMode;
  /** A fresh harness session on the diff spec, one per run (decision 137). */
  createSession: () => Promise<string>;
  /** What the diff spec is, stamped on the run the way the sandbox spec's is. */
  provenance: { model: string; rubricSha256: string; budgetTokens: number };
  caps: PrepareCaps;
}

export interface StartRunDeps {
  github: GitHubReader;
  store: RunStore;
  runner: Runner;
  diff?: DiffReviewDeps;
  /**
   * The detonation cache (decision 145). Optional so a composition without
   * it — every test that predates the cache — briefs the agent as before.
   */
  detonations?: Pick<DetonationCacheStore, "get" | "putForRun">;
  /**
   * The shadow review (decision 149). Optional so a composition without a
   * sidecar — and every test that predates it — asks nobody.
   */
  ocr?: Pick<OcrShadowDeps, "client" | "store">;
  /**
   * What the owner set per repository on the board (decision 155): the mode
   * under the repository's own file, and instructions. Optional so a
   * composition without it reads only the file, as before.
   */
  repositorySettings?: Pick<RepositorySettingsStore, "get">;
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
    // The shadow review (decision 149), before the mode is resolved so both
    // reviews get one, and never awaited so neither waits for it. Its own
    // catch: a sidecar failure is a warning line and not a failed run.
    if (deps.ocr) {
      void shadowReview({ ...deps.ocr, log }, pr, run).catch((error) =>
        log.warn("ocr.review.failed", errorFields(error)),
      );
    }
    // Which review this is (decision 135): the repository's word from base,
    // under the two floors, over the deploy default. Read here and not in the
    // webhook because it needs the pull request — the manifest flag and the
    // author — and the webhook never reads it. Without diff deps there is one
    // review, and it is the one every run was claimed as.
    const board = deps.repositorySettings?.get(run.repo);
    const { mode, reason } = deps.diff
      ? resolveMode({
          deployDefault: deps.diff.deployDefault,
          declared: await deps.github.declaredMode(run.repo, pr.baseSha),
          board: board?.mode ?? null,
          manifestChanged: manifestChanged(pr.changedFiles),
          authorIsBot: pr.authorIsBot,
        })
      : { mode: "sandbox" as const, reason: "deploy_default" as const };
    log.info("run.mode.resolved", { mode, reason });
    // The owner's guidance for this repository (decision 155): the file at
    // base, else the board, else nothing. Read for both reviews, and only in
    // a composition that has the board's layer — every test that predates it
    // composes a reader with no `readFile`, and briefs as before.
    const instructions = deps.repositorySettings
      ? await readInstructions(deps.github, deps.repositorySettings, run.repo, pr.baseSha)
      : null;
    if (instructions) log.info("run.instructions.read", { reason: instructions.source });
    if (mode === "diff" && deps.diff) {
      // The row was claimed on the pull request's sandbox session with the
      // sandbox spec's provenance; a diff run has a session and a spec of its
      // own (decision 137), so both are corrected before the turn exists, and
      // the record the runner is handed is the corrected one — `Runner.start`
      // reads the session id off its argument.
      const sessionId = await deps.diff.createSession();
      const pkg = await prepareReviewPackage(
        { github: deps.github, store: deps.store, caps: deps.diff.caps },
        pr,
        run,
        instructions,
      );
      const current = deps.store.updateRun(run.id, {
        sessionId,
        mode: "diff",
        ...deps.diff.provenance,
      });
      if (!current) throw new Error("run row vanished before its turn started");
      await deps.runner.start(current, buildDiffTurnMessage(pkg, deps.reviewRunId(current)));
      return;
    }
    // No line here: `Runner.start` emits run.turn.started once the harness has
    // returned the turn id, which is both the honest moment and the one that
    // can carry turn_id. Announcing it here as well produced two events per
    // start — and, when the start failed, a run.turn.started immediately
    // followed by run.turn.start.failed, describing a turn that never was.
    const current = deps.store.updateRun(run.id, { mode: "sandbox" }) ?? run;
    // What this instance already detonated for the exact specifiers this
    // head adds, handed to the agent in its brief (decision 145). Only when a
    // manifest changed, which is the only case `detonation` runs at all.
    const cached =
      deps.detonations && manifestChanged(pr.changedFiles)
        ? lookupCachedDetonations(deps.detonations, addedSpecifiers(pr.files), new Date())
        : { brief: [], kept: [] };
    if (cached.kept.length > 0) {
      // Kept on the run before the turn exists, so every fold of this run —
      // live, refold, rehydrate — substitutes the same entries (decision 148).
      deps.detonations?.putForRun(run.id, cached.kept);
      log.info("run.detonation.cached", {
        count: cached.kept.length,
        dependencies: cached.kept.map((c) => `${c.source} ${c.specifier}`).join(", "),
      });
    }
    await deps.runner.start(
      current,
      buildTurnMessage(pr, deps.reviewRunId(current), cached.brief, instructions),
    );
  } catch (error) {
    // The run ends in error with no turn, which lets a redelivery re-claim
    // the head (RunStore.createRun) instead of being refused as a duplicate.
    log.error("run.prepare.failed", errorFields(error));
    deps.runner.fail(run.id, `could not prepare run: ${String(error)}`);
  } finally {
    deps.onSettled?.(run.id);
  }
}
