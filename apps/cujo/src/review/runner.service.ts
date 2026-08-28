import { EventEmitter } from "node:events";
import {
  type Harness,
  STALE_DENY_REASON,
  type SessionEvent,
  type StreamEvent,
} from "../clients/trueforge";
import type { RunStore } from "../store";
import { fold, pendingApproval } from "./fold";
import type { PendingApproval, Projection, RunRecord } from "./types";

type AnyEvent = SessionEvent | StreamEvent;

interface RunState {
  events: AnyEvent[];
  cujoResumeTurnIds: Set<string>;
  subscribedTurnIds: Set<string>;
  pollTimer: NodeJS.Timeout | null;
  /** Set once a newer head replaced this run; the fold then reports it. */
  superseded: boolean;
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
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [2_000, 5_000, 15_000];
  }

  private state(runId: string): RunState {
    let s = this.states.get(runId);
    if (!s) {
      s = {
        events: [],
        cujoResumeTurnIds: new Set(this.store.listCujoTurns(runId)),
        subscribedTurnIds: new Set(),
        pollTimer: null,
        superseded: false,
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
    if (projection.status !== previousStatus && this.isTerminal(projection.status)) {
      console.info(`run ${runId}: status → ${projection.status}`);
    }
    // emit() is synchronous and rethrows into this call, which sits inside the
    // fold path: a subscriber that throws would surface as a stream error and
    // trigger a resubscribe. A subscriber must never be able to fail a run.
    try {
      const view = this.view(runId);
      this.changes.emit(runId, view);
      this.changes.emit(ANY_RUN, view);
    } catch (error) {
      console.error(`run ${runId}: change subscriber threw`, error);
    }
    return projection;
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
      console.error(`run ${runId}: could not read persisted events`, error);
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
   * every attempt fails the run ends in error rather than staying running.
   * One watchdog covers the whole sequence.
   */
  async consume(runId: string, stream: AsyncIterable<StreamEvent>): Promise<void> {
    let projection: Projection | null = null;
    let sawTerminal = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      console.info(`run ${runId}: turn timed out`);
      this.push(
        runId,
        errorTurnDone(`cujo-timeout-${Date.now()}`, "turn timeout: no terminal event"),
      );
      this.refold(runId);
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
          console.error(`run ${runId}: stream error`, error);
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
              console.error(`run ${runId}: resubscribe ${attempt} failed`, retryError);
            }
          }
        }
      }
      if (!sawTerminal && !timedOut) {
        this.push(runId, errorTurnDone(`cujo-stream-lost-${Date.now()}`, "turn stream lost"));
        projection = this.refold(runId);
      }
    } finally {
      clearTimeout(deadline);
    }
    if (!projection) projection = this.refold(runId);
    if (projection.status === "blocked_pending") this.startPolling(runId);
    else if (this.isTerminal(projection.status)) this.stopPolling(runId);
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
   * user message on the thread while one is pending (decision 37).
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
    sessionId: string,
    approval: PendingApproval,
    runId?: string,
  ): Promise<boolean> {
    try {
      const turnId = await this.harness.resume(sessionId, approval, "deny", STALE_DENY_REASON);
      console.info(`session ${sessionId}: stale approval denied as turn ${turnId}`);
      if (runId) {
        this.state(runId).cujoResumeTurnIds.add(turnId);
        this.store.addCujoTurn(runId, turnId);
      }
    } catch (error) {
      // The session stays wedged, exactly as it was before this call. The
      // next head retries through `start`, so the wedge is not permanent.
      console.error(`session ${sessionId}: could not deny the stale approval`, error);
      return false;
    }
    try {
      await this.harness.cancelTurn(sessionId);
    } catch (error) {
      console.warn(`session ${sessionId}: cancel after the stale deny failed`, error);
    }
    return true;
  }

  /**
   * A newer head on the same PR replaced this run. The run stops following
   * its turn, no decision can be made on it (the decision claim requires
   * blocked_pending), and a turn still running on the harness is cancelled
   * so it cannot post a review for a stale head. Resolves once the cancel
   * has been sent, so the caller can start the newer head's turn after it.
   *
   * A run waiting on a human is the case that matters: its approval is
   * answered rather than merely cancelled, or the pull request becomes
   * unreviewable for good (decision 37).
   */
  async supersede(runId: string): Promise<void> {
    const s = this.state(runId);
    if (s.superseded) return;
    s.superseded = true;
    console.info(`run ${runId}: superseded`);
    this.stopPolling(runId);
    const run = this.store.getRun(runId);
    // Read before the refold, which rewrites the status to `superseded`.
    const wasPending = run?.status === "blocked_pending";
    const live = run && run.turnIds.length > 0 && !this.isTerminal(run.status);
    // `fold` never clears `approval`, so it survives the refold; only the
    // status is overridden.
    const projection = this.refold(runId);
    if (!run) return;
    if (wasPending && projection.approval) {
      // Already in memory, so no round trip to find it.
      await this.denyStaleApproval(run.sessionId, projection.approval, runId);
      return;
    }
    if (!live) return;
    try {
      await this.harness.cancelTurn(run.sessionId);
    } catch (error) {
      // Already finished, or the harness is unreachable: nothing to cancel.
      console.warn(`run ${runId}: cancel after supersede failed`, error);
    }
  }

  /**
   * Clear an approval left pending on the session by something that is over.
   * Reports whether anything was cleared, so the caller knows a retry is worth
   * attempting.
   *
   * Refuses while any run on the session is `blocked_pending`: that approval
   * is one a human is being asked about right now, and denying it would answer
   * for them.
   */
  private async healSession(run: RunRecord): Promise<boolean> {
    const live = this.store
      .listRunsForSession(run.sessionId)
      .filter((other) => other.status === "blocked_pending");
    if (live.length > 0) {
      console.warn(`run ${run.id}: not healing, run ${live[0]?.id} is still waiting on a human`);
      return false;
    }
    try {
      const items = await this.harness.listEvents(run.sessionId);
      const approval = pendingApproval(items.map((item) => item.event));
      if (!approval) return false;
      console.warn(`run ${run.id}: session held a stale approval, clearing it`);
      // No run id: the run that raised it is terminal, so it is never
      // rehydrated (`listUnfinishedRuns` covers running and blocked_pending
      // only) and no live run adopts a turn it did not chain from.
      return await this.denyStaleApproval(run.sessionId, approval);
    } catch (error) {
      console.error(`run ${run.id}: could not inspect the session`, error);
      return false;
    }
  }

  /**
   * Start a run's first turn and fold it to the end. The turn is recorded as
   * the run's own before the subscribe, so a failed subscribe or a restart
   * in between can recover it instead of treating the run as turnless.
   *
   * One retry, after clearing an approval left pending on the session. That is
   * the failure that would otherwise make a pull request unreviewable for
   * good, and healing it here catches the cases `supersede` does not (decision
   * 37). The error text is not inspected: the 422 wording is TrueForge's, not
   * ours, and `startTurn` failing at all is rare enough to afford one lookup.
   */
  async start(run: RunRecord, message: string): Promise<void> {
    if (this.store.getRun(run.id)?.status !== "running" || this.state(run.id).superseded) return;
    let turnId: string;
    try {
      turnId = await this.harness.startTurn(run.sessionId, message);
    } catch (error) {
      console.warn(`run ${run.id}: could not start turn, looking for a stale approval`, error);
      if (!(await this.healSession(run))) {
        this.fail(run.id, `could not start turn: ${String(error)}`);
        return;
      }
      try {
        turnId = await this.harness.startTurn(run.sessionId, message);
      } catch (retryError) {
        console.error(`run ${run.id}: could not start turn after healing`, retryError);
        this.fail(run.id, `could not start turn: ${String(retryError)}`);
        return;
      }
    }
    console.info(`run ${run.id}: turn ${turnId} started`);
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
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const view = this.view(runId);
    if (!view) return { ok: false, reason: "no such run" };
    if (view.run.status !== "blocked_pending" || !view.projection.approval) {
      return { ok: false, reason: `run is ${view.run.status}, not blocked_pending` };
    }
    if (!this.store.claimDecision(runId, approver, new Date().toISOString())) {
      return { ok: false, reason: "already decided" };
    }
    this.stopPolling(runId);
    let turnId: string;
    try {
      turnId = await this.harness.resume(view.run.sessionId, view.projection.approval, decision);
    } catch (error) {
      this.store.clearDecision(runId);
      this.startPolling(runId);
      return { ok: false, reason: `resume failed: ${String(error)}` };
    }
    console.info(`run ${runId}: resumed as turn ${turnId} (${decision} by ${approver})`);
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
    console.info(
      `run ${run.id}: rehydrated, status=${projection.status}, turns=${projection.turnIds.length}`,
    );
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
      this.adoptTurn(runId, next.id);
      this.stopPolling(runId);
      await this.follow(runId, run.sessionId, next.id);
    } catch (error) {
      console.error(`run ${runId}: poll failed`, error);
    }
  }

  stopAll(): void {
    for (const runId of this.states.keys()) this.stopPolling(runId);
  }
}
