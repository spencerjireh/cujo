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
import type { BuildFactsStore } from "../store/build-facts";
import type { DetonationCacheStore } from "../store/detonations";
import type { ExecutionStore } from "../store/executions";
import type { RepositorySettingsStore } from "../store/repository-settings";
import {
  buildDiffTurnMessage,
  buildJudgeTurnMessage,
  buildTurnMessage,
  manifestChanged,
} from "./agent-spec";
import { lookupCachedDetonations } from "./detonation-cache";
import { type ExecuteDeps, executeDeclared } from "./execute";
import { readInstructions } from "./instructions";
import { resolveMode } from "./mode";
import { type OcrShadowDeps, shadowReview } from "./ocr-shadow";
import { readPolicy } from "./policy";
import { type PrepareCaps, prepareReviewPackage } from "./prepare";
import type { Runner } from "./runner.service";
import { addedSpecifiers } from "./specifiers";
import { type StageDeps, stageTrees } from "./stage";
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

/**
 * What a judge run needs (decision 161): the executor's sandbox door, the
 * store its results go to, a session on the judge spec, and the spec's
 * provenance. Optional on `StartRunDeps` so a composition without it — and
 * every test that predates it — starts every sandbox run as a gather run.
 */
interface JudgeDeps {
  /** `CUJO_EXECUTE_DECLARED`: off sends every run down the gather path. */
  enabled: boolean;
  sandbox: ExecuteDeps["sandbox"];
  executions: Pick<ExecutionStore, "putCheck" | "putSandbox">;
  /** A fresh harness session on the judge spec, one per run, like the diff review's. */
  createSession: () => Promise<string>;
  provenance: { model: string; rubricSha256: string };
  stepTimeoutMs: number;
  reportBytes: number;
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
   * Where a diff run's build facts are recorded before its turn exists
   * (decision 170). Optional so a composition without it — and every test
   * that predates the block — briefs and folds exactly as before.
   */
  buildFacts?: Pick<BuildFactsStore, "putForRun">;
  /**
   * The shadow review (decision 149). Optional so a composition without a
   * sidecar — and every test that predates it — asks nobody.
   */
  ocr?: Pick<OcrShadowDeps, "client" | "store"> & {
    /** The board's switch (decision 164), read per run; absent means on. */
    enabled?: () => boolean;
  };
  /**
   * What the owner set per repository on the board (decision 155): the mode
   * under the repository's own file, and instructions. Optional so a
   * composition without it reads only the file, as before.
   */
  repositorySettings?: Pick<RepositorySettingsStore, "get">;
  /**
   * Where a private repository's trees are staged for its sandbox (decision
   * 158). Optional so a composition without it — every test that predates
   * it — briefs a clone URL for every run, as before.
   */
  stage?: Pick<StageDeps, "stager">;
  /** The sandbox spec's token budget (decision 165), stamped on the row; absent means none. */
  sandboxBudgetTokens?: () => number;
  /** The sandbox turn's ceiling, told to the parent so it can bound its setup (decision 165). */
  turnTimeoutMs?: () => number;
  judge?: JudgeDeps;
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
    const ocrOn = deps.ocr !== undefined && (deps.ocr.enabled?.() ?? true);
    if (deps.ocr && !ocrOn) {
      // Switched off on the board (decision 164): nothing is asked and no
      // row is written, the way an instance with no sidecar behaves.
      log.info("ocr.skipped", { reason: "disabled" });
    } else if (deps.ocr && !run.isPublic) {
      // The sidecar holds no GitHub credential and clones by URL, which a
      // private repository refuses (decision 158). A line, not a failed row.
      log.info("ocr.skipped", { reason: "private" });
    } else if (deps.ocr) {
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
        { github: deps.github, store: deps.store, caps: deps.diff.caps, log },
        pr,
        run,
        instructions,
      );
      // Written before the turn exists, for the reason the briefed detonations
      // are: the findings these facts imply are derived on the trusted side,
      // and every later fold — live, refold, or a rehydration after a restart
      // — has to read the same facts the brief carried (decision 170).
      deps.buildFacts?.putForRun(run.id, pkg.buildFacts, new Date().toISOString());
      if (pkg.buildFacts.hazards.length > 0) {
        log.info("run.build_facts.read", {
          services: pkg.buildFacts.services.length,
          hazards: pkg.buildFacts.hazards.length,
        });
      }
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
    const current =
      deps.store.updateRun(run.id, {
        mode: "sandbox",
        ...(deps.sandboxBudgetTokens ? { budgetTokens: deps.sandboxBudgetTokens() } : {}),
      }) ?? run;
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
    // A private repository's trees, staged before the turn exists (decision
    // 158): the box cannot clone them, so the brief carries a ticket and no
    // clone URL. A failure here is the run's failure, below, before any
    // session was spent on it -- and so is a composition with no staging
    // door, since a clone URL the box cannot use would spend the session on
    // a clone that cannot succeed.
    const stage = deps.stage;
    if (!run.isPublic && !stage) {
      throw new Error("private repository, and no staging door is configured");
    }
    const staged =
      !run.isPublic && stage
        ? await stageTrees({ github: deps.github, stager: stage.stager, log }, pr)
        : "";
    // Which path (decision 161): the repository's declared commands run here
    // with no model and the parent judges, or the parent gathers as before.
    // Declared means a `test` in `.cujo.yml` at base that parsed.
    const judge = deps.judge;
    const policy = judge?.enabled ? await readPolicy(deps.github, log, run.repo, pr.baseSha) : null;
    const path = judge?.enabled && policy?.test ? "judge" : "gather";
    log.info("run.path.resolved", {
      path_kind: path,
      reason: !judge?.enabled ? "disabled" : policy?.test ? "declared" : "undeclared",
    });
    if (path === "judge" && judge && policy) {
      const execution = await executeDeclared(
        { sandbox: judge.sandbox, log, stepTimeoutMs: judge.stepTimeoutMs },
        {
          repo: run.repo,
          prNumber: run.prNumber,
          baseSha: pr.baseSha,
          headSha: run.headSha,
          cloneUrl: pr.cloneUrl,
          staged,
          ...(manifestChanged(pr.changedFiles)
            ? {
                detonate: {
                  added: addedSpecifiers(pr.files).map((a) => ({
                    source: a.source,
                    specifier: a.specifier,
                  })),
                  cached: cached.brief,
                },
              }
            : {}),
        },
        policy,
      );
      // Persisted before the turn exists, so every fold of this run — live,
      // refold, rehydrate — seats the same checks, and the runner knows
      // which box to destroy when the turn ends.
      judge.executions.putSandbox({
        runId: run.id,
        sandboxId: execution.sandboxId,
        provisionedMs: execution.provisionedMs,
        env: execution.env,
      });
      for (const executed of execution.executed) {
        judge.executions.putCheck({ runId: run.id, ...executed });
      }
      // A judge run has a session and a spec of its own, like a diff run
      // (decision 137): corrected on the row before the turn exists.
      const sessionId = await judge.createSession();
      const judged = deps.store.updateRun(run.id, {
        sessionId,
        mode: "sandbox",
        ...judge.provenance,
        ...(deps.sandboxBudgetTokens ? { budgetTokens: deps.sandboxBudgetTokens() } : {}),
      });
      if (!judged) throw new Error("run row vanished before its turn started");
      await deps.runner.start(
        judged,
        buildJudgeTurnMessage(
          pr,
          deps.reviewRunId(judged),
          instructions,
          {
            sandbox: { id: execution.sandboxId, env: execution.env },
            policy: {
              ...(policy.install ? { install: policy.install } : {}),
              ...(policy.test ? { test: policy.test } : {}),
              ...(policy.boot ? { boot: policy.boot } : {}),
              ...(policy.smoke ? { smoke: policy.smoke } : {}),
            },
            executed: execution.executed,
            coverage: {
              ran: execution.executed.map((e) => ({
                check: e.check,
                note: coverageNote(e.report),
              })),
              skipped: [],
            },
          },
          judge.reportBytes,
        ),
      );
      return;
    }
    await deps.runner.start(
      current,
      buildTurnMessage(
        pr,
        deps.reviewRunId(current),
        cached.brief,
        instructions,
        staged,
        deps.turnTimeoutMs?.() ?? 0,
      ),
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

/** One line for `coverage.ran`: what the executed check said, in numbers. */
function coverageNote(report: unknown): string {
  if (!report || typeof report !== "object") return "executed";
  const r = report as {
    base?: unknown;
    head?: unknown;
    base_pass_head_fail?: unknown;
    endpoints?: unknown;
    base_not_run?: unknown;
  };
  // Base is run only when head gives it something to answer (decision 169),
  // and a line that did not say so would read as a comparison that came back
  // clean.
  const skipped = r.base_not_run === true ? "base not run, head was clean: " : "";
  if (Array.isArray(r.endpoints)) {
    const rows = r.endpoints as { base_status?: unknown; head_status?: unknown }[];
    const answered = rows.filter((row) => typeof row.head_status === "number").length;
    const worse = rows.filter(
      (row) =>
        typeof row.base_status === "number" &&
        row.base_status < 400 &&
        (typeof row.head_status !== "number" || row.head_status >= 400),
    ).length;
    if (skipped) return `${skipped}${rows.length} requests, ${answered} answered on head`;
    return `${rows.length} requests on head and base; ${answered} answered on head, ${worse} worse than base`;
  }
  const count = (map: unknown) =>
    map && typeof map === "object" ? Object.keys(map as object).length : 0;
  const failed = Array.isArray(r.base_pass_head_fail) ? r.base_pass_head_fail.length : 0;
  if (skipped) return `${skipped}${count(r.head)} on head, nothing to compare`;
  return `${count(r.base)} on base and ${count(r.head)} on head; ${failed} passed on base and failed on head`;
}
