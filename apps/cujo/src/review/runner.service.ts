import { EventEmitter } from "node:events";
import { MAIN_THREAD } from "@cujo/harness-contract";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { Harness, SessionEvent, StreamEvent } from "../clients/harness";
import type { RunStore } from "../store";
import { announceEvidenceGaps, announceTimeout } from "./announce";
import { type DismissStaleReviewsDeps, dismissStaleReviews } from "./dismiss-stale";
import { validateEvent } from "./event-schema";
import { isMaliceClaim, isOperationalRule } from "./findings";
import { REVIEW_POST_FAILED, fold, lastTurnOutcome } from "./fold";
import type { UiLinks } from "./links";
import { runLogger } from "./start-run";
import { checkTimings } from "./timings";
import type { CheckState, Projection, RunRecord } from "./types";

type AnyEvent = SessionEvent | StreamEvent;

interface RunState {
  events: AnyEvent[];
  subscribedTurnIds: Set<string>;
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
  /** The harness session for this run, used by `run.setup.completed`. */
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
  /**
   * The ceiling for a diff run (Contract 11), which reads and posts and has no
   * sandbox to wait on; absent means the sandbox ceiling applies to both. Read
   * through `turnTimeoutFor`, never directly, so every site that names the
   * window — the watchdog, its log line, the timeout comment, the rehydrate
   * arithmetic — names the same one.
   */
  diffTurnTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Backoff before each resubscribe after a dropped stream. */
  retryDelaysMs?: number[];
  /**
   * Where a comment links for the evidence (decisions 109, 110). Absent means
   * no link, which is the same answer `runUrl` gives a private run — the comment
   * is still worth posting, it just has nowhere to point.
   */
  links?: UiLinks;
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
 * Why a dismissal was refused, as a closed set rather than a sentence. The
 * `reason` is countable and the human wording lives in `detail`, so the reply
 * on the pull request keeps its message and a query can still ask how often
 * GitHub refused the write.
 */
type DismissRefusal = "no_such_run" | "not_blocked" | "already_decided" | "github_failed";

export type DismissResult = { ok: true } | { ok: false; reason: DismissRefusal; detail: string };

const REFUSAL_TEXT: Record<DismissRefusal, string> = {
  no_such_run: "no such run",
  not_blocked: "run is not blocked",
  already_decided: "already dismissed",
  github_failed: "github write failed",
};

const TERMINAL_EVENT = "turn.done";

/**
 * Emitted for every run alongside the per-run key, so a process-wide
 * subscriber (the Discord notifier) needs no per-run wiring. A run id is a
 * randomUUID, so this key can never collide with one.
 */
export const ANY_RUN = "run:changed";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errorTurnDone(id: string, message: string): StreamEvent {
  const now = new Date().toISOString();
  return {
    type: "turn.done",
    id,
    createdAt: now,
    threadId: MAIN_THREAD,
    state: { status: "error", message, completedAt: now },
  };
}

/**
 * Keeps every active run's event list, folds it on each new event, persists
 * the projection, and tells SSE subscribers. The stream is the primary source;
 * a lost stream falls back to polling the turn until it ends.
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
    // Wider than `dismissStaleReviews` needs by one method, because the two
    // things the trusted side may say on a pull request both go through it: a
    // stale review dismissed, and the one comment a run gets when the agent
    // said nothing (decisions 109, 110). Still a `Pick`, so this class cannot
    // reach a write nobody has argued for.
    private readonly github:
      | (DismissStaleReviewsDeps["github"] & Pick<GitHubReader, "createComment">)
      | null = null,
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [2_000, 5_000, 15_000];
  }

  private state(runId: string): RunState {
    let s = this.states.get(runId);
    if (!s) {
      const run = this.store.getRun(runId);
      // One read, once per run per process. It is what stops a restart
      // re-announcing checks that finished before it, and it keeps the hot
      // path — `refold` runs once per stream event — free of any extra query.
      const stored = this.store.getProjection(runId);
      s = {
        events: [],
        subscribedTurnIds: new Set(),
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

  /** The watchdog window this run is under: its mode's, off the store. */
  private turnTimeoutFor(runId: string): number {
    const mode = this.store.getRun(runId)?.mode;
    return mode === "diff"
      ? (this.options.diffTurnTimeoutMs ?? this.options.turnTimeoutMs)
      : this.options.turnTimeoutMs;
  }

  private refold(runId: string): Projection {
    const s = this.state(runId);
    const run = this.store.getRun(runId);
    const projection = fold(s.events, run ? { mode: run.mode } : {});
    if (s.superseded) projection.status = "superseded";
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
    this.store.updateRun(runId, { status: projection.status, turnIds: projection.turnIds });
    this.emitChange(runId);
    return projection;
  }

  /**
   * Tell the subscribers the run moved. emit() is synchronous and rethrows
   * into the caller, which on the fold path sits inside the stream loop: a
   * subscriber that throws would surface as a stream error and trigger a
   * resubscribe. A subscriber must never be able to fail a run.
   */
  private emitChange(runId: string): void {
    try {
      const view = this.view(runId);
      this.changes.emit(runId, view);
      this.changes.emit(ANY_RUN, view);
    } catch (error) {
      this.state(runId).log.error("run.subscriber.threw", errorFields(error));
    }
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
    return status !== "running";
  }

  /** Append one event unless the same id was already seen (a resubscribe replays). */
  private push(runId: string, event: AnyEvent): boolean {
    const s = this.state(runId);
    if (s.events.some((e) => e.id === event.id)) return false;
    this.checkEvent(s.log, event);
    if (event.type === "turn.created") s.subscribedTurnIds.add(event.turnId);
    s.events.push(event);
    return true;
  }

  /**
   * Validate one event (decision 105). Warns on a shape mismatch; never
   * drops. The event stays in the fold regardless, so a field that moved
   * is visible rather than silently lost toward `clean`.
   */
  private checkEvent(log: Logger, event: unknown): void {
    const result = validateEvent(event);
    if (!result.valid) {
      log.warn("run.event.invalid", {
        event_type:
          typeof event === "object" && event !== null
            ? String((event as Record<string, unknown>).type ?? "unknown")
            : "unknown",
        problem: result.problem ?? "unknown",
      });
    }
  }

  /** Batch-validate a list of events (replay path). */
  private checkEvents(log: Logger, events: readonly unknown[]): void {
    for (const event of events) this.checkEvent(log, event);
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
    this.checkEvents(s.log, [...persisted.values()]);
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
   * Fire the watchdog: synthesize a terminal event and best-effort cancel the
   * turn on the harness. Extracted so both the timer callback and the
   * immediate-expiry path in `rehydrate` share one implementation
   * (decision 99).
   */
  private fireWatchdog(runId: string): void {
    this.state(runId).log.error("run.turn.timeout", { timeout_ms: this.turnTimeoutFor(runId) });
    this.state(runId).syntheticTerminal = true;
    this.push(
      runId,
      errorTurnDone(`cujo-timeout-${Date.now()}`, "turn timeout: no terminal event"),
    );
    this.refold(runId);
    const run = this.store.getRun(runId);
    const timedOutTurn = this.currentTurnId(runId);
    if (run && timedOutTurn && !this.state(runId).superseded) {
      void (async () => {
        try {
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
      })().catch((e) => {
        this.state(runId).log.warn("run.cancel.failed", {
          session_id: run.sessionId,
          reason: "watchdog_cleanup",
          ...errorFields(e),
        });
      });
      // Separate from the cancel above rather than sequenced after it: that
      // block returns early when the turn is already finished, and the reports
      // are worth posting either way.
      void this.announceTimedOut(runId, run, timedOutTurn).catch((e) => {
        this.state(runId).log.warn("review.announce.failed", {
          reason: "turn_timeout",
          ...errorFields(e),
        });
      });
    }
  }

  /**
   * Post what the turn did measure before its ceiling, instead of nothing
   * (decision 109).
   *
   * The read back is the whole of it. The stream delivers `model.message` as an
   * id-only stub, so folding what is in hand would lose every report's text and
   * the comment would say a check that worked reported nothing. `replayTurn`
   * already does that read, and already guards the synthetic terminal this
   * method's caller just appended across the await.
   */
  private async announceTimedOut(runId: string, run: RunRecord, turnId: string): Promise<void> {
    if (!this.github) return;
    // Falls back to what was persisted when the session cannot be read, because
    // a thinner comment still beats the silence this exists to end.
    const projection =
      (await this.harvest(run, turnId, this.state(runId))) ?? this.store.getProjection(runId);
    if (!projection) return;
    // The read back found a review the stream had not delivered yet. Then the
    // author already has it, and a comment saying the run did not finish would
    // contradict the thing sitting above it.
    if (projection.review) return;
    if (this.state(runId).superseded) return;
    await announceTimeout(
      this.announceDeps(runId),
      this.store.getRun(runId) ?? run,
      projection,
      this.turnTimeoutFor(runId),
    );
  }

  /**
   * What the turn actually did, read back from the session and folded **without
   * touching the run's own event list**.
   *
   * Deliberately not `replayTurn`. That method replaces `s.events` and keeps
   * only what arrived *during* its own await, so calling it from the watchdog
   * path would discard the synthetic terminal `fireWatchdog` appended just
   * before it — and the fold would go back to `running` with the timer already
   * spent, which is a run nothing can finish. The comment is a read, so this is
   * a read: nothing here persists, emits, or mutates.
   *
   * The read is what makes the comment true. A stream that never delivered a
   * terminal event never triggered `hydrate` either, so the events in hand can
   * hold a report as an id-only stub, and a comment built from those would tell
   * an author that a check which worked reported nothing.
   */
  private async harvest(run: RunRecord, turnId: string, s: RunState): Promise<Projection | null> {
    try {
      const items = await this.harness.listEvents(run.sessionId);
      const own = new Set([...run.turnIds, ...s.subscribedTurnIds, turnId]);
      const { events } = Runner.selectRunEvents(
        { ...run, turnIds: [...own] },
        items,
        this.foreignTurnIds(run),
      );
      if (events.length === 0) return null;
      return fold(events, { mode: run.mode });
    } catch (error) {
      s.log.warn("run.hydrate.failed", { session_id: run.sessionId, ...errorFields(error) });
      return null;
    }
  }

  /**
   * Tell the author when the review that posted had gaps in its evidence
   * (decision 110).
   *
   * Silent unless an operational rule tripped, which is the common case.
   */
  private async announceGaps(runId: string, projection: Projection): Promise<void> {
    if (!this.github) return;
    const run = this.store.getRun(runId);
    if (!run || this.state(runId).superseded) return;
    await announceEvidenceGaps(this.announceDeps(runId), run, projection);
  }

  private announceDeps(runId: string) {
    if (!this.github) throw new Error("no github client");
    return {
      github: this.github,
      log: this.state(runId).log,
      claim: (id: string, kind: string) => this.store.claimAnnouncement(id, kind),
      links: this.options.links ?? { publicBaseUrl: "" },
    };
  }

  /**
   * Consume a turn stream to its end, folding as events arrive. A stream that
   * drops before its terminal event is resubscribed with bounded backoff; if
   * every attempt fails the turn is *watched* rather than declared dead, since
   * losing the stream says nothing about the work. One watchdog covers the
   * whole sequence, and it is the only place a verdict is invented.
   *
   * `budgetMs` overrides the default timeout when the caller knows the run
   * has already consumed part of its budget (decision 99: rehydrate computes
   * the remainder from `run.createdAt`).
   */
  async consume(
    runId: string,
    stream: AsyncIterable<StreamEvent>,
    budgetMs?: number,
  ): Promise<void> {
    const s = this.state(runId);
    let projection: Projection | null = null;
    let sawTerminal = false;
    let timedOut = false;
    const timeoutMs = budgetMs ?? this.turnTimeoutFor(runId);
    const deadline = setTimeout(() => {
      timedOut = true;
      this.fireWatchdog(runId);
    }, timeoutMs);

    const drain = async (source: AsyncIterable<StreamEvent>): Promise<void> => {
      for await (const event of source) {
        if (event.type === "model.message.delta") continue;
        if (event.type === TERMINAL_EVENT) sawTerminal = true;
        const fresh = this.push(runId, event);
        // The stream's model.message is a stub without content or tool calls;
        // the persisted copy has both. Re-read at the end so the fold sees the
        // posted review and the summary.
        if (fresh && sawTerminal) await this.hydrate(runId);
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
    if (projection.status === "running") {
      // Nothing follows this method. The stream is done with and the watchdog
      // was cleared in the `finally` above, so a run still `running` here can
      // never reach a verdict by any path. Three separate defects have landed
      // in this state during one change alone, so the invariant is enforced
      // where it is owned rather than argued about at each call site. Saying
      // the turn could not be followed is the honest report: it is what was
      // observed.
      this.state(runId).log.error("run.stream.lost", { attempts: this.retryDelaysMs.length });
      this.fail(runId, "turn could not be followed to its end");
      projection = this.refold(runId);
    }
    if (this.isTerminal(projection.status)) {
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
      void this.announceGaps(runId, projection).catch((err) =>
        this.state(runId).log.warn("review.announce.failed", {
          reason: "evidence_gap",
          ...errorFields(err),
        }),
      );
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
   * A plain loop: `consume` is already async and already under the watchdog,
   * so waiting on the turn in hand needs no timer to reason about.
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
    // What the run held before the read. Anything that appears while it is in
    // flight was appended by something else -- the watchdog's synthetic
    // terminal, above all -- and must survive the replacement below.
    const beforeIds = new Set(s.events.map((e) => e.id));
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
        // The read crossed an await, and the watchdog can fire inside it. A
        // wholesale assignment would drop the synthetic terminal it appended,
        // and the fold would go back to `running` with the timer already spent
        // -- a run nothing can finish. Keep whatever arrived meanwhile.
        const replayed = new Set(events.map((e) => e.id));
        const appended = s.events.filter((e) => !beforeIds.has(e.id) && !replayed.has(e.id));
        this.checkEvents(s.log, events);
        s.events = [...events, ...appended];
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
   * review tool, for one — and none of those is visible from the raw
   * `turn.done`. The cost is that
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
    // Nothing that reached the pull request may be repeated: a recorded
    // review is a posted one.
    if (projection.review) return false;
    // A cancelled turn was stopped on purpose — by `supersede` or by an
    // operator. `fold` flattens that into `error` with the reason in prose,
    // so ask the events rather than matching on that sentence.
    if (lastTurnOutcome(s.events) === "cancelled") return false;
    // A ceiling the harness enforced is deterministic: the same brief on the
    // same spec spends the same tokens, so a second attempt buys a second
    // bill and the same error (decision 132). A held call is the same shape:
    // a spec that gates a tool gates it again (decision 138). So is a post
    // GitHub refused: the same head gets the same 422, and the retry would be
    // a second sandbox for it (decision 140).
    if (projection.error?.startsWith("token budget exhausted")) return false;
    if (projection.error?.startsWith("approval requested")) return false;
    if (projection.error?.startsWith(REVIEW_POST_FAILED)) return false;
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
  private follow(
    runId: string,
    sessionId: string,
    turnId: string,
    budgetMs?: number,
  ): Promise<void> {
    const harness = this.harness;
    async function* lazy(): AsyncIterable<StreamEvent> {
      yield* await harness.subscribe(sessionId, turnId);
    }
    return this.consume(runId, lazy(), budgetMs);
  }

  /** End a run that never got a turn: the webhook could not prepare it. */
  fail(runId: string, message: string): void {
    this.push(runId, errorTurnDone(`cujo-start-error-${Date.now()}`, message));
    this.refold(runId);
  }

  /**
   * A newer head on the same PR replaced this run, or `/cujo review` asked
   * for its head again. The run stops following its turn, and a turn still
   * running on the harness is cancelled so it cannot post a review for a
   * stale head.
   *
   * Answers whether the turn is **confirmed** stopped: cancelled, already
   * terminal, or never started. `false` means this call could not establish
   * that — the harness refused the cancel, or somebody else superseded it
   * first. The webhook path ignores the answer, because a stale run left
   * running is merely wasteful there; `/cujo review` reads it, because it is
   * about to supersede the run's row (decision 104) and a live turn on the
   * session could still post a review for the old head. The `superseded`
   * status is persisted only after cancellation is confirmed, so the partial
   * unique index continues protecting the head until then.
   *
   * A finished run — `blocked` included — is superseded in the store alone
   * and emitted, so the card, the reaction and the check run hear that a
   * newer commit moved it on.
   */
  async supersede(runId: string): Promise<boolean> {
    const s = this.state(runId);
    // Already superseded by someone else, and this call cannot see whether
    // their cancel landed. `false` means "not confirmed", never "still live".
    if (s.superseded) return false;
    s.superseded = true;
    s.log.info("run.superseded", { reason: "newer_head" });
    const run = this.store.getRun(runId);
    const live = run && run.turnIds.length > 0 && !this.isTerminal(run.status);
    if (!run || !live) {
      this.refold(runId);
      return true;
    }
    try {
      await this.harness.cancelTurn(run.sessionId);
      this.refold(runId);
      return true;
    } catch (error) {
      // Cancel failed: revert the in-memory flag so the partial index still
      // protects this head, and the consume loop stays aware.
      s.superseded = false;
      s.log.warn("run.cancel.failed", {
        session_id: run.sessionId,
        reason: "supersede",
        ...errorFields(error),
      });
      return false;
    }
  }

  /**
   * Start a run's first turn and fold it to the end. The turn is recorded as
   * the run's own before the subscribe, so a failed subscribe or a restart
   * in between can recover it instead of treating the run as turnless.
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
      log.error("run.turn.start.failed", {
        session_id: run.sessionId,
        attempt: 1,
        ...errorFields(error),
      });
      this.fail(run.id, `could not start turn: ${String(error)}`);
      return;
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
   * The unlock (decision 138): a person with write access lifted a block with
   * `/cujo dismiss`. The dismissal is claimed atomically in the store before
   * GitHub is written, so two comments racing for one block dismiss the
   * review once; a GitHub write that fails releases the claim so the next
   * comment can try again.
   *
   * The trusted side's record moves whatever GitHub holds. Zero matching
   * reviews is not a failure — somebody may have dismissed the bot's review
   * by hand on GitHub first — and a runner built without a GitHub client
   * still moves the row, because the row is what the check run, the card and
   * the reaction read.
   */
  async dismiss(runId: string, approver: string): Promise<DismissResult> {
    // Deliberately not `this.state(runId)` before the run is known to exist:
    // `state()` inserts, and nothing ever removes, so a comment naming a run
    // that does not exist would grow the map for the life of the process.
    const refuse = (reason: DismissRefusal, detail?: string): DismissResult => {
      const log = this.states.has(runId)
        ? this.state(runId).log
        : this.log.child({ run_id: runId });
      log.warn("dismiss.rejected", { actor: approver, reason });
      return { ok: false, reason, detail: detail ?? REFUSAL_TEXT[reason] };
    };
    const run = this.store.getRun(runId);
    if (!run) return refuse("no_such_run");
    if (run.status !== "blocked") {
      return refuse("not_blocked", `run is ${run.status}, not blocked`);
    }
    if (!this.store.claimDecision(runId, approver, new Date().toISOString())) {
      return refuse("already_decided");
    }
    const log = this.state(runId).log;
    const login = approver.replace(/^github:/, "");
    try {
      if (this.github) {
        const mine = (await this.github.listBotReviews(run.repo, run.prNumber)).filter(
          (review) => review.state === "CHANGES_REQUESTED" && review.commitId === run.headSha,
        );
        for (const review of mine) {
          await this.github.dismissReview(
            run.repo,
            run.prNumber,
            review.id,
            `Dismissed by @${login} with /cujo dismiss.`,
          );
        }
      }
    } catch (error) {
      this.store.clearDecision(runId);
      log.warn("dismiss.rejected", {
        actor: approver,
        reason: "github_failed",
        ...errorFields(error),
      });
      return {
        ok: false,
        reason: "github_failed",
        detail: `github write failed: ${String(error)}`,
      };
    }
    // Written the way `refold` writes a status, minus the fold: no event says
    // a block was lifted, so the projection is moved by hand and the same
    // line announces it.
    const projection = this.store.getProjection(runId);
    if (projection) {
      projection.status = "dismissed";
      this.store.putProjection(runId, projection);
    }
    this.store.updateRun(runId, { status: "dismissed" });
    log.info("run.status.changed", { from: "blocked", to: "dismissed" });
    // The audit line for a decision a human made. `actor` is the login the
    // store has just recorded as the approver, so the log and the row agree
    // by construction.
    log.info("dismiss.applied", { actor: approver });
    this.emitChange(runId);
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
    this.checkEvents(s.log, events);
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
      if (!turnId) return;
      // The watchdog bounds the *turn*, not the current process's attention
      // span (decision 99). Compute how much budget remains from the
      // active turn's own start time; if the budget is already spent,
      // fire immediately rather than granting a fresh window that every
      // redeploy renews. The anchor is the latest turn.created event, not
      // run.createdAt, because a run that went through preparation should
      // not charge that time against the turn's budget.
      const turnStart = [...s.events].reverse().find((e) => e.type === "turn.created")?.createdAt;
      const anchor = turnStart ? new Date(turnStart).getTime() : new Date(run.createdAt).getTime();
      const elapsed = Date.now() - anchor;
      const timeoutMs = this.turnTimeoutFor(run.id);
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) {
        s.log.info("run.rehydrate.expired", {
          elapsed_ms: elapsed,
          timeout_ms: timeoutMs,
        });
        this.fireWatchdog(run.id);
        return;
      }
      void this.follow(run.id, run.sessionId, turnId, remaining).catch((e) => {
        s.log.warn("run.rehydrate.failed", { ...errorFields(e) });
      });
    }
  }
}
