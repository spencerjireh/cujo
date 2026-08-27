import { EventEmitter } from "node:events";
import { fold } from "./folder";
import type { Store } from "./store";
import type { Harness, SessionEvent, StreamEvent } from "./trueforge";
import type { Projection, RunRecord } from "./types";

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
    private readonly store: Store,
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
    // The run may have recorded a turn whose turn.created has not arrived yet.
    for (const turnId of run?.turnIds ?? []) {
      if (!projection.turnIds.includes(turnId)) projection.turnIds.push(turnId);
    }
    this.store.putProjection(runId, projection);
    const patch: Parameters<Store["updateRun"]>[1] = {
      status: projection.status,
      turnIds: projection.turnIds,
    };
    if (projection.externalResume && run && !run.approver) {
      patch.approver = "external";
      patch.decidedAt = new Date().toISOString();
    }
    this.store.updateRun(runId, patch);
    this.changes.emit(runId, this.view(runId));
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
        if (this.push(runId, event)) projection = this.refold(runId);
        if (sawTerminal) return;
      }
    };

    try {
      let current: AsyncIterable<StreamEvent> | null = stream;
      while (current && !timedOut) {
        try {
          await drain(current);
          break;
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
   * A newer head on the same PR replaced this run. The run stops following
   * its turn, no decision can be made on it (the decision claim requires
   * blocked_pending), and a turn still running on the harness is cancelled
   * so it cannot post a review for a stale head. Resolves once the cancel
   * has been sent, so the caller can start the newer head's turn after it.
   */
  async supersede(runId: string): Promise<void> {
    const s = this.state(runId);
    if (s.superseded) return;
    s.superseded = true;
    this.stopPolling(runId);
    const run = this.store.getRun(runId);
    const live = run && run.turnIds.length > 0 && !this.isTerminal(run.status);
    this.refold(runId);
    if (!live) return;
    try {
      await this.harness.cancelTurn(run.sessionId);
    } catch (error) {
      // Already finished, or the harness is unreachable: nothing to cancel.
      console.warn(`run ${runId}: cancel after supersede failed`, error);
    }
  }

  /**
   * Start a run's first turn and fold it to the end. The turn is recorded as
   * the run's own before the subscribe, so a failed subscribe or a restart
   * in between can recover it instead of treating the run as turnless.
   */
  async start(run: RunRecord, message: string): Promise<void> {
    if (this.store.getRun(run.id)?.status !== "running" || this.state(run.id).superseded) return;
    let turnId: string;
    try {
      turnId = await this.harness.startTurn(run.sessionId, message);
    } catch (error) {
      console.error(`run ${run.id}: could not start turn`, error);
      this.fail(run.id, `could not start turn: ${String(error)}`);
      return;
    }
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
