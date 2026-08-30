import { EventEmitter } from "node:events";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import {
  type Harness,
  STALE_DENY_REASON,
  type SessionEvent,
  type StreamEvent,
} from "../clients/trueforge";
import type { RunStore } from "../store";
import { type DismissStaleReviewsDeps, dismissStaleReviews } from "./dismiss-stale";
import { isMaliceClaim, isOperationalRule } from "./findings";
import { fold, lastTurnOutcome, pendingApproval } from "./fold";
import { runLogger } from "./start-run";
import { checkTimings } from "./timings";
import type { CheckState, PendingApproval, Projection, RunRecord } from "./types";

type AnyEvent = SessionEvent | StreamEvent;

interface RunState {
  events: AnyEvent[];
  cujoResumeTurnIds: Set<string>;
  subscribedTurnIds: Set<string>;
  pollTimer: NodeJS.Timeout | null;
  /** Set once a newer head replaced this run; the fold then reports it. */
  superseded: boolean;
  /**
   * The message `start` was called with, so a retry can start the same turn
   * again. `consume` does not otherwise have it, and rebuilding it would mean
   * reading the pull request a second time.
   */
  turnMessage: string | null;
  /** One retry per run, and this is how it is spent. */
  retried: boolean;
  /**
   * Set when the terminal event was one Cujo synthesised rather than one the
   * harness sent: a watchdog timeout, a lost stream, or a turn that never
   * started. None of the three is worth retrying — the first already spent the
   * turn timeout, and the other two say the harness is unreachable — and none
   * can be told apart from a real `turn.done` once it is in the event list.
   */
  syntheticTerminal: boolean;
  /**
   * What the checks looked like the last time this process reported them, so
   * `refold` can emit a line per transition rather than one per event
   * (decision 37). Seeded from the stored projection when the state is first
   * built, so a run rehydrated after a restart does not re-announce every
   * check that had already finished before it.
   */
  reportedChecks: Map<string, CheckState["status"]>;
  /** Whether `run.setup.completed` has been emitted for this run. */
  setupReported: boolean;
  /** Hard-rule findings already announced, keyed by `rule:check`. */
  reportedHardRules: Set<string>;
  /** The TrueForge session for this run, used by `run.setup.completed`. */
  sessionId: string | null;
  /** The run's own logger, bound once. */
  log: Logger;
}

export interface RunView {
  run: RunRecord;
  projection: Projection;
}

export interface RunnerOptions {
  turnTimeoutMs: number;
  pollIntervalMs?: number;
  /** Backoff before each resubscribe after a dropped stream. */
  retryDelaysMs?: number[];
}

/**
 * How long a check took, for the log line, in the event clock rather than the
 * wall clock.
 *
 * The rule this used to state in full now lives in `checkTimings`, which
 * computes the same wall time and two more numbers beside it: omitted rather
 * than guessed when either endpoint is missing, because a check whose thread
 * events carried no timestamp has no honest duration and a zero would read as
 * an instantaneous check. The field stays `duration_ms` because
 * `packages/log` declares that name and nothing else means the same thing.
 */
function durationOf(check: CheckState): { duration_ms?: number } {
  const { wallMs } = checkTimings(check);
  return wallMs === undefined ? {} : { duration_ms: wallMs };
}

/**
 * Why an approval was refused, as a closed set rather than a sentence.
 *
 * The 409 body used to carry four different conditions as one opaque string —
 * "no such run", "already decided", a status mismatch, and a failed resume all
 * arrived as prose a caller could only match on. The `reason` is now countable
 * and the human wording moves to `detail`, so the UI keeps its message and a
 * query can still ask how often a resume failed.
 */
export type ApproveRefusal =
  | "no_such_run"
  | "not_blocked_pending"
  | "already_decided"
  | "resume_failed";

export type ApproveResult = { ok: true } | { ok: false; reason: ApproveRefusal; detail: string };

const REFUSAL_TEXT: Record<ApproveRefusal, string> = {
  no_such_run: "no such run",
  not_blocked_pending: "run is not blocked_pending",
  already_decided: "already decided",
  resume_failed: "resume failed",
};

const TERMINAL_EVENT = "turn.done";

/**
 * Emitted for every run alongside the per-run key, so a process-wide
 * subscriber (the Discord notifier) needs no per-run wiring. A run id is a
 * randomUUID, so this key can never collide with one.
 */
export const ANY_RUN = "run:changed";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * How many times a stale deny will re-clear the session.
 *
 * Denying an approval resumes the turn, and the resumed turn can call the
 * gated tool again and raise a *second* approval before the cancel that
 * follows lands. One pass therefore answers the approval it was given and
 * leaves a fresh one behind, which is the wedge it exists to prevent. Three is
 * a bound, not a guess: the loop stops as soon as a read comes back clear, and
 * a model that keeps re-raising past that is a run nobody wants resumed.
 */
const STALE_DENY_ROUNDS = 3;
/** Long enough for the cancel to settle server-side, short enough not to hold up the next head. */
const STALE_DENY_SETTLE_MS = 250;

function errorTurnDone(id: string, message: string): StreamEvent {
  const now = new Date().toISOString();
  return {
    type: "turn.done",
    id,
    createdAt: now,
    threadId: null,
    state: { status: "error", message, completedAt: now },
  };
}

/**
 * Keeps every active run's event list, folds it on each new event, persists
 * the projection, and tells SSE subscribers. The stream is the primary source;
 * a poll on the session catches turns Cujo did not start (Contract 6,
 * "a resume apps/cujo did not send is still tracked").
 *
 * One session serves every run on a PR, so a run must know which turns are
 * its own: the id of each turn Cujo creates is recorded before its first
 * event, and turns recorded by another run on the session are never adopted.
 */
export class Runner {
  private readonly states = new Map<string, RunState>();
  readonly changes = new EventEmitter();
  private readonly retryDelaysMs: number[];

  constructor(
    private readonly store: RunStore,
    private readonly harness: Harness,
    private readonly options: RunnerOptions = { turnTimeoutMs: 30 * 60 * 1000 },
    private readonly log: Logger = createLogger({ service: "cujo" }),
    private readonly github: DismissStaleReviewsDeps["github"] | null = null,
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [2_000, 5_000, 15_000];
  }

  private state(runId: string): RunState {
    let s = this.states.get(runId);
    if (!s) {
      const run = this.store.getRun(runId);
      // One read, once per run per process, at the point `listCujoTurns`
      // already reads. It is what stops a restart re-announcing checks that
      // finished before it, and it keeps the hot path — `refold` runs once
      // per stream event — free of any extra query.
      const stored = this.store.getProjection(runId);
      s = {
        events: [],
        cujoResumeTurnIds: new Set(this.store.listCujoTurns(runId)),
        subscribedTurnIds: new Set(),
        pollTimer: null,
        superseded: false,
        turnMessage: null,
        retried: false,
        syntheticTerminal: false,
        setupReported: (stored?.checks ?? []).some((c) => c.isCheck),
        reportedHardRules: new Set(
          (stored?.hardRuleHits ?? []).filter((f) => f.rule).map((f) => `${f.rule}:${f.check}`),
        ),
        sessionId: run?.sessionId ?? null,
        reportedChecks: new Map(
          (stored?.checks ?? []).map((check) => [check.threadId, check.status]),
        ),
        log: run ? runLogger(this.log, run) : this.log.child({ run_id: runId }),
      };
      this.states.set(runId, s);
    }
    return s;
  }

  view(runId: string): RunView | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    const projection = this.store.getProjection(runId) ?? fold([]);
    return { run, projection };
  }

  private refold(runId: string): Projection {
    const s = this.state(runId);
    const projection = fold(s.events, { cujoResumeTurnIds: s.cujoResumeTurnIds });
    if (s.superseded) projection.status = "superseded";
    const run = this.store.getRun(runId);
    const previousStatus = run?.status;
    // The run may have recorded a turn whose turn.created has not arrived yet.
    for (const turnId of run?.turnIds ?? []) {
      if (!projection.turnIds.includes(turnId)) projection.turnIds.push(turnId);
    }
    // Emitted before the projection is persisted, and never from `fold`.
    //
    // Not from `fold` because it is pure and replayed in full on every
    // rehydrate, so a line there would re-announce a run's whole history at
    // each restart. `refold` is already the single place every status is
    // written, so "one writer, one emitter" is a property the code had rather
    // than one the log invents.
    //
    // Before the write because `reportedChecks` is seeded from the persisted
    // projection: persisting first and dying in the gap would leave the next
    // process treating a transition it never announced as already reported,
    // and the line would be missing forever. This way the same crash costs a
    // duplicate on restart, which is recoverable and visible. For an audit
    // trail, saying something twice beats losing it once.
    if (projection.status !== previousStatus) {
      s.log.info("run.status.changed", {
        from: previousStatus ?? null,
        to: projection.status,
        ...(projection.error ? { error_message: projection.error } : {}),
      });
    }
    this.reportChecks(s, projection);
    this.store.putProjection(runId, projection);
    const patch: Parameters<RunStore["updateRun"]>[1] = {
      status: projection.status,
      turnIds: projection.turnIds,
    };
    if (projection.externalResume && run && !run.approver) {
      patch.approver = "external";
      patch.decidedAt = new Date().toISOString();
    }
    this.store.updateRun(runId, patch);
    // emit() is synchronous and rethrows into this call, which sits inside the
    // fold path: a subscriber that throws would surface as a stream error and
    // trigger a resubscribe. A subscriber must never be able to fail a run.
    try {
      const view = this.view(runId);
      this.changes.emit(runId, view);
      this.changes.emit(ANY_RUN, view);
    } catch (error) {
      s.log.error("run.subscriber.threw", errorFields(error));
    }
    return projection;
  }

  /**
   * One line per check that started or finished, rather than one per fold.
   *
   * `duration_ms` comes from the check's own `startedAt` and `endedAt`, which
   * `fold` takes from the thread events' `createdAt` rather than the clock —
   * so a run rehydrated hours later still reports the time the check actually
   * took, not the time since the restart.
   */
  private reportChecks(s: RunState, projection: Projection): void {
    for (const check of projection.checks) {
      if (!check.isCheck) continue;
      const seen = s.reportedChecks.get(check.threadId);
      if (seen === check.status) continue;
      s.reportedChecks.set(check.threadId, check.status);
      if (check.status === "running") {
        if (!s.setupReported) {
          s.setupReported = true;
          s.log.info("run.setup.completed", { session_id: s.sessionId });
        }
        s.log.info("check.started", { check: check.title, thread_id: check.threadId });
        continue;
      }
      s.log.info("check.finished", {
        check: check.title,
        thread_id: check.threadId,
        status: check.status,
        ...durationOf(check),
      });
    }
    for (const finding of projection.hardRuleHits) {
      if (!finding.rule) continue;
      const key = `${finding.rule}:${finding.check}`;
      if (s.reportedHardRules.has(key)) continue;
      s.reportedHardRules.add(key);
      s.log.warn("check.hard_rule.tripped", {
        rule: finding.rule,
        check: finding.check,
        severity: finding.severity,
        claim: isMaliceClaim(finding)
          ? "malice"
          : isOperationalRule(finding)
            ? "operational"
            : "correctness",
      });
    }
  }

  private isTerminal(status: Projection["status"]): boolean {
    return status !== "running" && status !== "blocked_pending";
  }

  /** Append one event unless the same id was already seen (a resubscribe replays). */
  private push(runId: string, event: AnyEvent): boolean {
    const s = this.state(runId);
    if (s.events.some((e) => e.id === event.id)) return false;
    if (event.type === "turn.created") s.subscribedTurnIds.add(event.turnId);
    s.events.push(event);
    return true;
  }

  /** Record a turn as the run's own before any of its events arrive. */
  private adoptTurn(runId: string, turnId: string): void {
    this.state(runId).subscribedTurnIds.add(turnId);
    const run = this.store.getRun(runId);
    if (run && !run.turnIds.includes(turnId)) {
      this.store.updateRun(runId, { turnIds: [...run.turnIds, turnId] });
    }
  }

  /** The turn the run is on: the newest turn.created seen, else the last recorded. */
  private currentTurnId(runId: string): string | null {
    const s = this.state(runId);
    for (let i = s.events.length - 1; i >= 0; i -= 1) {
      const e = s.events[i];
      if (e?.type === "turn.created") return e.turnId;
    }
    return this.store.getRun(runId)?.turnIds.at(-1) ?? null;
  }

  /**
   * Replace stream events with their persisted versions. The server's turn
   * stream sends `model.message` as an id-only stub (the text and tool calls
   * arrive as deltas and are persisted whole), so the events kept for the
   * fold are refreshed from `listEvents`, matched by id. A failed read keeps
   * the stream's events; the next decision point reads again.
   */
  private async hydrate(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    const s = this.state(runId);
    const own = new Set([...run.turnIds, ...s.subscribedTurnIds]);
    let items: { turnId: string; event: SessionEvent }[];
    try {
      items = await this.harness.listEvents(run.sessionId);
    } catch (error) {
      s.log.warn("run.hydrate.failed", { session_id: run.sessionId, ...errorFields(error) });
      return;
    }
    const persisted = new Map<string, SessionEvent>();
    for (const item of items) if (own.has(item.turnId)) persisted.set(item.event.id, item.event);
    s.events = s.events.map((e) => persisted.get(e.id) ?? e);
  }

  /** Turns recorded by other runs on the same session; never this run's. */
  private foreignTurnIds(run: RunRecord): Set<string> {
    const foreign = new Set<string>();
    for (const other of this.store.listRunsForSession(run.sessionId)) {
      if (other.id === run.id) continue;
      for (const turnId of other.turnIds) foreign.add(turnId);
    }
    return foreign;
  }

  /**
   * Consume a turn stream to its end, folding as events arrive. A stream that
   * drops before its terminal event is resubscribed with bounded backoff; if
   * every attempt fails the turn is *watched* rather than declared dead, since
   * losing the stream says nothing about the work. One watchdog covers the
   * whole sequence, and it is the only place a verdict is invented.
   */
  async consume(runId: string, stream: AsyncIterable<StreamEvent>): Promise<void> {
    const s = this.state(runId);
    let projection: Projection | null = null;
    let sawTerminal = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      this.state(runId).log.error("run.turn.timeout", { timeout_ms: this.options.turnTimeoutMs });
      this.state(runId).syntheticTerminal = true;
      this.push(
        runId,
        errorTurnDone(`cujo-timeout-${Date.now()}`, "turn timeout: no terminal event"),
      );
      this.refold(runId);
      // The one place Cujo ends a turn on its own authority, so the one place
      // that must clean up after itself. Left running, the turn holds the
      // session and every later head fails to start on it -- TrueForge refuses
      // a message while sub-agents run, and neither the status nor a later
      // cancel can find it by then.
      const run = this.store.getRun(runId);
      const timedOutTurn = this.currentTurnId(runId);
      // Awaited inside its own task, not chained with `.catch`: this runs in a
      // timer callback, where a synchronous throw has no caller to land on and
      // would take the process down rather than the turn.
      if (run && timedOutTurn && !this.state(runId).superseded) {
        void (async () => {
          try {
            // `cancelTurn` takes a session and stops whatever is running on it
            // *now*, which is not necessarily what timed out. Runs share a
            // pull request's session, and this timer stays armed until its own
            // `consume` returns, so a supersede that lands first can have a
            // newer head's turn running by the time this fires. Cancel only
            // while the turn that timed out is still the one in progress.
            const turns = await this.harness.listTurns(run.sessionId);
            const mine = turns.find((t) => t.id === timedOutTurn);
            if (mine?.state.status !== "running") return;
            await this.harness.cancelTurn(run.sessionId);
          } catch (error) {
            this.state(runId).log.warn("run.cancel.failed", {
              session_id: run.sessionId,
              reason: "turn_timeout",
              ...errorFields(error),
            });
          }
          // Terminal catch on a detached promise, even though the body already
          // handles its own failure: if the logging above is what threw, there
          // is nothing left to report it with, and an unhandled rejection out
          // of a timer callback would end the process.
        })().catch(() => {});
      }
    }, this.options.turnTimeoutMs);

    const drain = async (source: AsyncIterable<StreamEvent>): Promise<void> => {
      for await (const event of source) {
        if (event.type === "model.message.delta") continue;
        if (event.type === TERMINAL_EVENT) sawTerminal = true;
        const fresh = this.push(runId, event);
        // The stream's model.message is a stub without content or tool calls;
        // the persisted copy has both. Re-read at the points a decision is
        // made so the fold sees the drafted review and the summary.
        if (fresh && (sawTerminal || event.type === "tool.approval_required")) {
          await this.hydrate(runId);
        }
        if (fresh) projection = this.refold(runId);
        if (sawTerminal) return;
      }
    };

    try {
      let current: AsyncIterable<StreamEvent> | null = stream;
      while (current && !timedOut) {
        try {
          await drain(current);
          if (sawTerminal) break;
          // A stream that ends cleanly before the terminal event (the
          // server's subscribe window or a proxy idle limit closed it) is
          // a drop like any other: the turn is still running.
          throw new Error("stream ended before the terminal event");
        } catch (error) {
          s.log.warn("run.stream.dropped", errorFields(error));
          current = null;
          const turnId = this.currentTurnId(runId);
          const run = this.store.getRun(runId);
          // The budget is per drop: a stream that recovers earns a fresh one,
          // and the watchdog bounds the whole sequence.
          let attempt = 0;
          while (attempt < this.retryDelaysMs.length && turnId && run && !timedOut) {
            const delay = this.retryDelaysMs[attempt] ?? 0;
            attempt += 1;
            await sleep(delay);
            try {
              current = await this.harness.subscribe(run.sessionId, turnId);
              break;
            } catch (retryError) {
              // `attempt` was incremented above, so it is already the
              // 1-based number of the attempt that just failed.
              s.log.warn("run.stream.resubscribe.failed", {
                turn_id: turnId,
                attempt,
                delay_ms: delay,
                ...errorFields(retryError),
              });
            }
          }
        }
      }
      if (!sawTerminal && !timedOut) {
        // Every resubscribe is spent, which says the stream is gone -- not that
        // the turn is. Injecting a terminal event here published a verdict
        // about work Cujo had merely stopped watching, and that error then hid
        // the run from `listUnfinishedRuns`, so nothing superseded it and its
        // turn was never cancelled. Watch the turn instead; the watchdog above
        // still bounds the wait (spec Contract 6, the `error` row).
        s.log.error("run.stream.lost", { attempts: this.retryDelaysMs.length });
        projection = await this.watchTurn(runId, () => timedOut);
      }
    } finally {
      clearTimeout(deadline);
    }
    if (!projection) projection = this.refold(runId);
    if (await this.retryTurn(runId, projection)) return;
    if (projection.status === "blocked_pending") this.startPolling(runId);
    else if (this.isTerminal(projection.status)) {
      this.stopPolling(runId);
      if (projection.status === "clean" && this.github) {
        const run = this.store.getRun(runId);
        if (run) {
          void dismissStaleReviews(
            { github: this.github, log: this.state(runId).log },
            run,
            projection,
          ).catch((err) =>
            this.state(runId).log.warn("review.stale.dismiss.failed", errorFields(err)),
          );
        }
      }
    }
  }

  /**
   * Wait out a turn whose stream is gone, then fold what it actually did.
   *
   * A lost stream is lost observability, not a failed turn: the work carries on
   * server-side, holds the session, and can still post its review. So the state
   * is read rather than guessed -- `listTurns` carries each turn's real status
   * -- and the verdict comes from the persisted events once the turn ends, the
   * same way a restart rebuilds one.
   *
   * Deliberately not `startPolling`: that timer is a per-run singleton whose
   * callback stops itself unless the run is `blocked_pending` and hunts for a
   * *successor* turn. This waits on the turn already in hand, and `consume` is
   * already async and already under the watchdog, so a plain loop needs no new
   * machinery and no second timer to reason about.
   *
   * Every exit is a real projection, so `consume`'s tail is reached exactly as
   * it would have been had the stream survived.
   */
  private async watchTurn(runId: string, timedOut: () => boolean): Promise<Projection> {
    const s = this.state(runId);
    const interval = this.options.pollIntervalMs ?? 15_000;
    const turnId = this.currentTurnId(runId);
    if (!turnId) {
      // Nothing to wait on, and the watchdog dies with this call -- returning
      // here would leave the run `running` with nobody left to end it, which is
      // the one failure the synthetic terminal did exist to prevent. Saying so
      // is not a guess: the absence of a turn is observed, and `rehydrate`
      // already reports it the same way.
      this.fail(runId, "run lost before its turn started");
      return this.refold(runId);
    }
    while (!timedOut() && !s.superseded) {
      await sleep(interval);
      if (timedOut() || s.superseded) break;
      const run = this.store.getRun(runId);
      if (!run) break;
      let turn: Awaited<ReturnType<Harness["listTurns"]>>[number] | undefined;
      try {
        turn = (await this.harness.listTurns(run.sessionId)).find((t) => t.id === turnId);
      } catch (error) {
        // A read that fails is not a verdict either. The watchdog is the bound.
        s.log.warn("run.poll.failed", { session_id: run.sessionId, ...errorFields(error) });
        continue;
      }
      if (turn?.state.status === "running") continue;
      // The turn is over, or the server no longer lists it. Either way there is
      // something to read back now.
      const projection = await this.replayTurn(runId, run, turnId);
      // `running` is the one status that means the replay taught us nothing --
      // it failed, or came back without the terminal tail. That is not a
      // verdict, so stay under the watchdog and read again rather than let
      // `consume` return with the timer about to be cleared and no follower,
      // no poller and no watchdog left to finish the run.
      if (projection.status !== "running") {
        s.log.info("run.stream.recovered", {
          turn_id: turnId,
          status: turn?.state.status ?? "unlisted",
        });
        return projection;
      }
    }
    return this.refold(runId);
  }

  /**
   * Rebuild a run's fold from the session's persisted events.
   *
   * `hydrate` cannot do this: it refreshes events already held, matched by id,
   * and the whole problem after a lost stream is the events that never arrived.
   * This is what `rehydrate` does on restart, minus the resubscribe.
   */
  private async replayTurn(runId: string, run: RunRecord, turnId: string): Promise<Projection> {
    const s = this.state(runId);
    try {
      const items = await this.harness.listEvents(run.sessionId);
      // `selectRunEvents` seeds ownership from `run.turnIds` and chains forward
      // from there. The turn being replayed is this run's by definition -- it
      // is the one it was streaming -- so name it, rather than depend on it
      // having been recorded before the stream broke.
      const own = new Set([...run.turnIds, ...s.subscribedTurnIds, turnId]);
      const { events, turnIds } = Runner.selectRunEvents(
        { ...run, turnIds: [...own] },
        items,
        this.foreignTurnIds(run),
      );
      // Never trade events in hand for none: a session that answers with
      // nothing this run owns leaves the stream's own fold standing.
      if (events.length > 0) {
        s.events = events;
        s.subscribedTurnIds = new Set([...s.subscribedTurnIds, ...turnIds]);
      }
    } catch (error) {
      s.log.warn("run.hydrate.failed", { session_id: run.sessionId, ...errorFields(error) });
    }
    return this.refold(runId);
  }

  /**
   * Start the turn over, once, when it ended in error having posted nothing.
   *
   * The stream had careful backoff and the turn had none: a provider 5xx, or a
   * turn the harness gave up on, left the run in `error` with no review on the
   * pull request and nothing that would ever try again.
   *
   * It hooks in **after** the refold rather than inside `drain`, and that is a
   * trade made deliberately. Several of the errors worth retrying are ones the
   * fold decides rather than the stream — a turn that ended without calling a
   * review tool, one that drafted a gated review no approval was raised for —
   * and none of those is visible from the raw `turn.done`. The cost is that
   * `refold` has already persisted `error` and emitted, so the board, the
   * Discord card and the pull request's reaction show the failure and then go
   * back to running. That is honest: the turn really did fail.
   *
   * Returns whether it started one, so the caller can leave the terminal
   * bookkeeping alone.
   */
  private async retryTurn(runId: string, projection: Projection): Promise<boolean> {
    const s = this.state(runId);
    if (projection.status !== "error") return false;
    if (s.retried || s.superseded || s.syntheticTerminal) return false;
    // Nothing that reached the pull request may be repeated. `review` is only
    // ever an ungated call, so a recorded one is a posted one, and a drafted
    // gated review means a human is or was involved.
    if (projection.review || projection.gatedReview || projection.approval) return false;
    // A cancelled turn was stopped on purpose — by `supersede`, by a deny, or
    // by an operator. `fold` flattens that into `error` with the reason in
    // prose, so ask the events rather than matching on that sentence.
    if (lastTurnOutcome(s.events) === "cancelled") return false;
    const run = this.store.getRun(runId);
    const message = s.turnMessage;
    if (!run || !message) return false;

    s.retried = true;
    s.log.warn("run.turn.retried", { reason: projection.error ?? "turn ended in error" });
    // The event list has to go, and this is not tidiness. `fold`'s `turn.done`
    // case opens with `if (p.status === "error") break`, so the first turn's
    // failure would short-circuit the second turn's terminal event and the run
    // would sit in `error` however well the retry went. `reportedChecks` goes
    // with it, or the second attempt's checks are never announced.
    s.events = [];
    s.reportedChecks.clear();
    this.store.updateRun(runId, { status: "running" });
    this.refold(runId);
    await this.start(run, message);
    return true;
  }

  /**
   * Subscribe to a recorded turn and consume it. The subscribe happens inside
   * the stream so a failure takes the same resubscribe path as a drop.
   */
  private follow(runId: string, sessionId: string, turnId: string): Promise<void> {
    const harness = this.harness;
    async function* lazy(): AsyncIterable<StreamEvent> {
      yield* await harness.subscribe(sessionId, turnId);
    }
    return this.consume(runId, lazy());
  }

  /** End a run that never got a turn: the webhook could not prepare it. */
  fail(runId: string, message: string): void {
    this.push(runId, errorTurnDone(`cujo-start-error-${Date.now()}`, message));
    this.refold(runId);
  }

  /**
   * Answer an approval nobody is going to decide, so the session can take
   * another turn. An approval is outstanding on the *session*, not on the turn
   * that requested it: the turn that raised it has already ended, so
   * cancelling a turn does not answer it, and TrueForge refuses every later
   * user message on the thread while one is pending (decision 39).
   *
   * The deny starts a turn of its own, which is cancelled straight after: the
   * agent it belongs to is holding a review of a commit nobody is looking at.
   * When the owning run is known, that turn is recorded as Cujo's so the fold
   * can never read it as a resume someone sent from outside.
   *
   * Reports whether the deny landed, which is what decides if the session can
   * take a turn now.
   */
  private async denyStaleApproval(
    log: Logger,
    sessionId: string,
    approval: PendingApproval,
    reason: "newer_head" | "wedged_session",
    runId?: string,
  ): Promise<boolean> {
    let turnId: string;
    try {
      turnId = await this.harness.resume(sessionId, approval, "deny", STALE_DENY_REASON);
    } catch (error) {
      // The session stays wedged, exactly as it was before this call. The
      // next head retries through `start`, so the wedge is not permanent.
      log.warn("run.approval.clear.failed", {
        session_id: sessionId,
        reason,
        ...errorFields(error),
      });
      return false;
    }
    // Outside the try, and deliberately: a store failure here would be caught
    // as "could not deny" and reported as one, which is a lie in the audit
    // trail and sends `supersede` down the fall-through cancel for a deny that
    // did land. `approve` records its turn unguarded for the same reason.
    // On the heal path `run_id` is the run doing the healing, not the run that
    // raised the approval — that one is terminal, which is why it has no id
    // here. The attribution is right: it says who cleared it.
    log.info("run.approval.cleared", { session_id: sessionId, turn_id: turnId, reason });
    if (runId) {
      this.state(runId).cujoResumeTurnIds.add(turnId);
      this.store.addCujoTurn(runId, turnId);
    }
    try {
      await this.harness.cancelTurn(sessionId);
    } catch (error) {
      log.warn("run.cancel.failed", {
        session_id: sessionId,
        reason: "stale_deny",
        ...errorFields(error),
      });
    }
    // The deny resumed the turn, and a resumed turn can call the gated tool
    // again — raising a second approval before the cancel above lands. Answering
    // one and leaving the next is the wedge this method exists to prevent, so
    // the session is read back and cleared until it comes up empty. Failures
    // here do not flip the result: the approval this call was given *was*
    // answered, and `start` still has its own heal for whatever is left.
    for (let round = 1; round < STALE_DENY_ROUNDS; round++) {
      await sleep(STALE_DENY_SETTLE_MS);
      let next: PendingApproval | null;
      try {
        const items = await this.harness.listEvents(sessionId);
        next = pendingApproval(items.map((item) => item.event));
      } catch {
        break;
      }
      if (!next) break;
      log.info("run.approval.reraised", { session_id: sessionId, reason, round });
      try {
        const again = await this.harness.resume(sessionId, next, "deny", STALE_DENY_REASON);
        log.info("run.approval.cleared", { session_id: sessionId, turn_id: again, reason });
        if (runId) {
          this.state(runId).cujoResumeTurnIds.add(again);
          this.store.addCujoTurn(runId, again);
        }
        await this.harness.cancelTurn(sessionId);
      } catch (error) {
        log.warn("run.approval.clear.failed", {
          session_id: sessionId,
          reason,
          ...errorFields(error),
        });
        break;
      }
    }
    return true;
  }

  /**
   * A newer head on the same PR replaced this run. The run stops following
   * its turn, no decision can be made on it (the decision claim requires
   * Answers whether the turn is **confirmed** stopped: cancelled, already
   * terminal, or never started. `false` means this call could not establish
   * that — the harness refused the cancel, a decision is landing on the run, or
   * somebody else superseded it first. The webhook path ignores the answer,
   * because a stale run left running is merely wasteful there; `/cujo review`
   * reads it, because it is about to delete the run's row and a live turn with
   * no row can still post a review.
   *
   * blocked_pending), and a turn still running on the harness is cancelled
   * so it cannot post a review for a stale head. Resolves once the cancel
   * has been sent, so the caller can start the newer head's turn after it.
   *
   * A run waiting on a human is the case that matters: its approval is
   * answered rather than merely cancelled, or the pull request becomes
   * unreviewable for good (decision 39).
   */
  async supersede(runId: string): Promise<boolean> {
    const s = this.state(runId);
    // Already superseded by someone else, and this call cannot see whether
    // their cancel landed. `false` means "not confirmed", never "still live".
    if (s.superseded) return false;
    s.superseded = true;
    s.log.info("run.superseded", { reason: "newer_head" });
    this.stopPolling(runId);
    const run = this.store.getRun(runId);
    // Read before the refold, which rewrites the status to `superseded`.
    const wasPending = run?.status === "blocked_pending";
    const live = run && run.turnIds.length > 0 && !this.isTerminal(run.status);
    // `fold` never clears `approval`, so it survives the refold; only the
    // status is overridden.
    const projection = this.refold(runId);
    if (!run) return true;
    if (wasPending && projection.approval) {
      // Already in memory, so no round trip to find it. A deny that lands has
      // cancelled the turn it started and there is nothing else to stop.
      if (
        await this.denyStaleApproval(s.log, run.sessionId, projection.approval, "newer_head", runId)
      )
        return true;
      // It did not land, and the likeliest reason is that a human's decision
      // answered the approval first: `claimDecision` sets `approver` but leaves
      // the run `blocked_pending`, so a decision can be in flight and invisible
      // to the status check above.
      //
      // Re-read rather than trusting `run`. That snapshot predates both the
      // refold and the await just above, and the whole point of this branch is
      // a decision that lands during exactly that window — the stale copy would
      // still say `approver` is null and cancel the turn anyway.
      if (this.store.getRun(runId)?.approver) {
        // Leave it alone. The cancel would kill the turn that decision started,
        // while the row — and the reply already on the pull request — record
        // the person as having decided. Silently discarding an answer somebody
        // gave is worse than posting a verdict about a commit that has since
        // been pushed past: the finding was real on the commit they read, the
        // observation half is public either way, and the new head gets its own
        // run that re-derives it.
        s.log.info("run.supersede.deferred", { reason: "decision_in_flight" });
        return false;
      }
    }
    if (!live) return true;
    try {
      await this.harness.cancelTurn(run.sessionId);
      return true;
    } catch (error) {
      // Already finished, or the harness is unreachable: nothing to cancel.
      s.log.warn("run.cancel.failed", {
        session_id: run.sessionId,
        reason: "supersede",
        ...errorFields(error),
      });
      return false;
    }
  }

  /**
   * Any run on the session, other than this one, that could still acquire or
   * own an approval. `blocked_pending` is not enough on its own: a run whose
   * turn has already raised `tool.approval_required` stays `running` until its
   * own stream folds that event, so an approval the server would report as
   * pending can belong to a run that has not yet reached the waiting state.
   */
  private othersInFlight(run: RunRecord): RunRecord[] {
    return this.store
      .listRunsForSession(run.sessionId)
      .filter((other) => other.id !== run.id && !this.isTerminal(other.status));
  }

  /**
   * Clear an approval left pending on the session by something that is over.
   * Reports whether anything was cleared, so the caller knows a retry is worth
   * attempting.
   *
   * Refuses while any other run on the session is unfinished. That approval
   * may be one a human is being asked about, and answering it for them is the
   * one thing this must never do. The check is repeated after the read, since
   * `listEvents` is a network round trip a run can cross the line during; the
   * heal only ever runs when every other run on the pull request is already
   * terminal, which is what `startRun` guarantees before it starts a turn.
   */
  private async healSession(run: RunRecord): Promise<boolean> {
    const log = this.state(run.id).log;
    const busy = (): boolean => {
      const others = this.othersInFlight(run);
      if (others.length === 0) return false;
      // The blocking run's id cannot go in `run_id`: bound fields win over
      // call-site fields, so it would be overwritten with this run's id and
      // the line would name the wrong run. `session_id` finds them all.
      log.warn("run.approval.clear.skipped", {
        session_id: run.sessionId,
        reason: "run_in_flight",
        status: others[0]?.status ?? null,
        active: others.length,
      });
      return true;
    };
    // Checked before the read as well, to skip the round trip entirely.
    if (busy()) return false;
    let approval: PendingApproval | null;
    try {
      const items = await this.harness.listEvents(run.sessionId);
      approval = pendingApproval(items.map((item) => item.event));
    } catch (error) {
      // Only the read is guarded. `denyStaleApproval` reports its own failure
      // with its own reason, and folding it in here would label it
      // `session_unreadable` the first time it throws.
      log.warn("run.approval.clear.failed", {
        session_id: run.sessionId,
        reason: "session_unreadable",
        ...errorFields(error),
      });
      return false;
    }
    if (!approval) return false;
    if (busy()) return false;
    // No run id: the run that raised it is terminal, so it is never
    // rehydrated (`listUnfinishedRuns` covers running and blocked_pending
    // only) and no live run adopts a turn it did not chain from.
    return await this.denyStaleApproval(log, run.sessionId, approval, "wedged_session");
  }

  /**
   * Start a run's first turn and fold it to the end. The turn is recorded as
   * the run's own before the subscribe, so a failed subscribe or a restart
   * in between can recover it instead of treating the run as turnless.
   *
   * One retry, after clearing an approval left pending on the session. That is
   * the failure that would otherwise make a pull request unreviewable for
   * good, and healing it here catches the cases `supersede` does not (decision
   * 39). The error text is not inspected: the 422 wording is TrueForge's, not
   * ours, and `startTurn` failing at all is rare enough to afford one lookup.
   */
  async start(run: RunRecord, message: string): Promise<void> {
    // Kept so a retry can start the same turn again without reading the pull
    // request a second time.
    this.state(run.id).turnMessage = message;
    if (this.store.getRun(run.id)?.status !== "running" || this.state(run.id).superseded) return;
    const log = this.state(run.id).log;
    let turnId: string;
    try {
      turnId = await this.harness.startTurn(run.sessionId, message);
    } catch (error) {
      // Recorded before the heal, never after it. `healSession` is a network
      // round trip, and a process that died inside it would otherwise leave no
      // record that the turn failed to start at all — the same reasoning
      // `refold` uses when it announces a transition before persisting it.
      // `attempt` is what tells this line apart from the retry's, and both stay
      // at `error` so a filter that already watches this name sees a wedged
      // session even when the heal rescues it.
      log.error("run.turn.start.failed", {
        session_id: run.sessionId,
        attempt: 1,
        ...errorFields(error),
      });
      if (!(await this.healSession(run))) {
        this.fail(run.id, `could not start turn: ${String(error)}`);
        return;
      }
      try {
        turnId = await this.harness.startTurn(run.sessionId, message);
      } catch (retryError) {
        log.error("run.turn.start.failed", {
          session_id: run.sessionId,
          attempt: 2,
          ...errorFields(retryError),
        });
        this.fail(run.id, `could not start turn: ${String(retryError)}`);
        return;
      }
    }
    this.state(run.id).log.info("run.turn.started", { turn_id: turnId });
    this.adoptTurn(run.id, turnId);
    if (this.state(run.id).superseded) {
      // Replaced while the turn was being created; do not let it run on.
      await this.harness.cancelTurn(run.sessionId).catch(() => {});
      return;
    }
    await this.follow(run.id, run.sessionId, turnId);
  }

  /**
   * Contract 6 approve route. The decision is claimed atomically in the store
   * before the harness is called, so two operators cannot resume the same
   * pending call; a resume that never reaches the harness releases the claim.
   */
  async approve(
    runId: string,
    decision: "allow" | "deny",
    approver: string,
  ): Promise<ApproveResult> {
    // Deliberately not `this.state(runId)` before the run is known to exist:
    // `state()` inserts, and nothing ever removes, so an authenticated POST to
    // /runs/<anything>/approve would grow the map for the life of the process.
    // A run that does not exist gets a plain child logger and no state.
    const refuse = (reason: ApproveRefusal, detail?: string): ApproveResult => {
      const log = this.states.has(runId)
        ? this.state(runId).log
        : this.log.child({ run_id: runId });
      log.warn("approve.rejected", { decision, actor: approver, reason });
      return { ok: false, reason, detail: detail ?? REFUSAL_TEXT[reason] };
    };
    const view = this.view(runId);
    if (!view) return refuse("no_such_run");
    const log = this.state(runId).log;
    if (view.run.status !== "blocked_pending" || !view.projection.approval) {
      return refuse("not_blocked_pending", `run is ${view.run.status}, not blocked_pending`);
    }
    if (!this.store.claimDecision(runId, approver, new Date().toISOString())) {
      return refuse("already_decided");
    }
    this.stopPolling(runId);
    let turnId: string;
    try {
      turnId = await this.harness.resume(view.run.sessionId, view.projection.approval, decision);
    } catch (error) {
      this.store.clearDecision(runId);
      this.startPolling(runId);
      log.warn("approve.rejected", {
        decision,
        actor: approver,
        reason: "resume_failed",
        ...errorFields(error),
      });
      return { ok: false, reason: "resume_failed", detail: `resume failed: ${String(error)}` };
    }
    // The audit line for a decision a human made. `actor` is the Access email
    // the store has just recorded as the approver, so the log and the row
    // agree by construction.
    this.state(runId).log.info("approve.applied", { decision, actor: approver, turn_id: turnId });
    // Cujo's own resume, recorded before the subscribe and before its
    // turn.created, so the fold never mistakes it for an external one, on
    // this process or after a restart.
    this.state(runId).cujoResumeTurnIds.add(turnId);
    this.store.addCujoTurn(runId, turnId);
    this.adoptTurn(runId, turnId);
    void this.follow(runId, view.run.sessionId, turnId).then(() => this.refold(runId));
    return { ok: true };
  }

  /**
   * Select the events that belong to this run from the whole session: the
   * run's recorded turns and every turn chained to them by previousTurnId,
   * except turns another run on the session recorded as its own.
   */
  static selectRunEvents(
    run: RunRecord,
    items: { turnId: string; event: SessionEvent }[],
    foreignTurnIds: ReadonlySet<string> = new Set(),
  ): { events: SessionEvent[]; turnIds: Set<string> } {
    const own = new Set<string>(run.turnIds);
    const events: SessionEvent[] = [];
    for (const item of items) {
      const event = item.event;
      if (event.type === "turn.created" && !own.has(event.turnId)) {
        const chained = event.previousTurnId !== null && own.has(event.previousTurnId);
        if (chained && !foreignTurnIds.has(event.turnId)) own.add(event.turnId);
      }
      if (own.has(item.turnId)) events.push(event);
    }
    return { events, turnIds: own };
  }

  /** Rebuild from the session's persisted events after a restart. */
  async rehydrate(run: RunRecord): Promise<void> {
    const s = this.state(run.id);
    if (run.turnIds.length === 0) {
      // The process died between the claim and the turn. Nothing on the
      // session is known to be this run's; a redelivery re-claims the head.
      this.fail(run.id, "run lost before its turn started");
      return;
    }
    const items = await this.harness.listEvents(run.sessionId);
    const { events, turnIds } = Runner.selectRunEvents(run, items, this.foreignTurnIds(run));
    s.events = events;
    s.subscribedTurnIds = new Set(turnIds);
    const projection = this.refold(run.id);
    s.log.info("run.rehydrated", {
      status: projection.status,
      attempts: projection.turnIds.length,
    });
    const last = s.events.at(-1);
    if (projection.status === "running" && (!last || last.type !== TERMINAL_EVENT)) {
      const turnId = projection.turnIds.at(-1);
      if (turnId) void this.follow(run.id, run.sessionId, turnId);
    } else if (projection.status === "blocked_pending") {
      this.startPolling(run.id);
    }
  }

  private startPolling(runId: string): void {
    const s = this.state(runId);
    if (s.pollTimer) return;
    const interval = this.options.pollIntervalMs ?? 15_000;
    s.pollTimer = setInterval(() => void this.pollForNewTurn(runId), interval);
    s.pollTimer.unref();
  }

  private stopPolling(runId: string): void {
    const s = this.state(runId);
    if (s.pollTimer) clearInterval(s.pollTimer);
    s.pollTimer = null;
  }

  private async pollForNewTurn(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || run.status !== "blocked_pending") {
      this.stopPolling(runId);
      return;
    }
    const s = this.state(runId);
    try {
      const turns = await this.harness.listTurns(run.sessionId);
      const lastKnown = run.turnIds.at(-1);
      const foreign = this.foreignTurnIds(run);
      const next = turns.find(
        (t) =>
          t.previousTurnId === lastKnown && !s.subscribedTurnIds.has(t.id) && !foreign.has(t.id),
      );
      if (!next) return;
      // A turn this process did not start: somebody resumed the run from the
      // TrueForge console. The projection records that as `external`, and this
      // is the moment it was noticed.
      s.log.info("run.poll.adopted", { turn_id: next.id, reason: "external_turn" });
      this.adoptTurn(runId, next.id);
      this.stopPolling(runId);
      await this.follow(runId, run.sessionId, next.id);
    } catch (error) {
      s.log.warn("run.poll.failed", { session_id: run.sessionId, ...errorFields(error) });
    }
  }

  stopAll(): void {
    for (const runId of this.states.keys()) this.stopPolling(runId);
  }
}
