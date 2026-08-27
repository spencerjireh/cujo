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
        cujoResumeTurnIds: new Set(),
        subscribedTurnIds: new Set(),
        pollTimer: null,
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
    this.store.putProjection(runId, projection);
    const patch: Parameters<Store["updateRun"]>[1] = {
      status: projection.status,
      turnIds: projection.turnIds,
    };
    const run = this.store.getRun(runId);
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

  /** The turn the run is on, from the newest turn.created seen. */
  private currentTurnId(runId: string): string | null {
    const s = this.state(runId);
    for (let i = s.events.length - 1; i >= 0; i -= 1) {
      const e = s.events[i];
      if (e?.type === "turn.created") return e.turnId;
    }
    return null;
  }

  /**
   * Consume a turn stream to its end, folding as events arrive. A stream that
   * drops before its terminal event is resubscribed with bounded backoff; if
   * every attempt fails the run ends in error rather than staying running.
   * One watchdog covers the whole sequence.
   */
  async consume(runId: string, stream: AsyncIterable<StreamEvent>): Promise<void> {
    const s = this.state(runId);
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
      let attempt = 0;
      while (current && !timedOut) {
        try {
          await drain(current);
          break;
        } catch (error) {
          console.error(`run ${runId}: stream error`, error);
          current = null;
          const turnId = this.currentTurnId(runId);
          const run = this.store.getRun(runId);
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

  /** Start a run's first turn and fold it in the background. */
  start(run: RunRecord, message: string): void {
    void this.harness
      .startTurn(run.sessionId, message)
      .then((stream) => this.consume(run.id, stream))
      .catch((error) => {
        console.error(`run ${run.id}: could not start turn`, error);
        this.push(
          run.id,
          errorTurnDone(`cujo-start-error-${Date.now()}`, `could not start turn: ${String(error)}`),
        );
        this.refold(run.id);
      });
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
    let stream: AsyncIterable<StreamEvent>;
    try {
      stream = await this.harness.resume(view.run.sessionId, view.projection.approval, decision);
    } catch (error) {
      this.store.clearDecision(runId);
      this.startPolling(runId);
      return { ok: false, reason: `resume failed: ${String(error)}` };
    }
    // The resume turn's id is only known from its turn.created event, so mark
    // it as Cujo's own the moment it appears.
    const marked = this.markFirstTurnAsOwn(runId, stream);
    void this.consume(runId, marked).then(() => this.refold(runId));
    return { ok: true };
  }

  private async *markFirstTurnAsOwn(
    runId: string,
    stream: AsyncIterable<StreamEvent>,
  ): AsyncIterable<StreamEvent> {
    const s = this.state(runId);
    for await (const event of stream) {
      if (event.type === "turn.created") s.cujoResumeTurnIds.add(event.turnId);
      yield event;
    }
  }

  /**
   * Select the events that belong to this run from the whole session: the
   * run's first turn and every turn chained to it by previousTurnId. A run
   * with no recorded turn yet starts at the first turn created after the run.
   */
  static selectRunEvents(
    run: RunRecord,
    items: { turnId: string; event: SessionEvent }[],
  ): { events: SessionEvent[]; turnIds: Set<string> } {
    const own = new Set<string>(run.turnIds);
    const events: SessionEvent[] = [];
    for (const item of items) {
      const event = item.event;
      if (event.type === "turn.created" && !own.has(event.turnId)) {
        const chained = event.previousTurnId !== null && own.has(event.previousTurnId);
        const starts = own.size === 0 && event.createdAt >= run.createdAt;
        if (chained || starts) own.add(event.turnId);
      }
      if (own.has(item.turnId)) events.push(event);
    }
    return { events, turnIds: own };
  }

  /** Rebuild from the session's persisted events after a restart. */
  async rehydrate(run: RunRecord): Promise<void> {
    const s = this.state(run.id);
    const items = await this.harness.listEvents(run.sessionId);
    const { events, turnIds } = Runner.selectRunEvents(run, items);
    s.events = events;
    s.subscribedTurnIds = new Set(turnIds);
    const projection = this.refold(run.id);
    const last = s.events.at(-1);
    if (projection.status === "running" && last && last.type !== TERMINAL_EVENT) {
      const turnId = projection.turnIds.at(-1);
      if (turnId) {
        void this.harness
          .subscribe(run.sessionId, turnId)
          .then((stream) => this.consume(run.id, stream))
          .catch((error) => {
            console.error(`run ${run.id}: resubscribe after restart failed`, error);
            this.push(run.id, errorTurnDone(`cujo-rehydrate-${Date.now()}`, "turn stream lost"));
            this.refold(run.id);
          });
      }
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
      const next = turns.find(
        (t) => t.previousTurnId === lastKnown && !s.subscribedTurnIds.has(t.id),
      );
      if (!next) return;
      s.subscribedTurnIds.add(next.id);
      this.stopPolling(runId);
      const stream = await this.harness.subscribe(run.sessionId, next.id);
      await this.consume(runId, stream);
    } catch (error) {
      console.error(`run ${runId}: poll failed`, error);
    }
  }

  stopAll(): void {
    for (const runId of this.states.keys()) this.stopPolling(runId);
  }
}
