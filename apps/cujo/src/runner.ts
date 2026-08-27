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

/**
 * Keeps every active run's event list, folds it on each new event, persists
 * the projection, and tells SSE subscribers. The stream is the primary source;
 * a poll on the session catches turns Cujo did not start (Contract 6,
 * "a resume apps/cujo did not send is still tracked").
 */
export class Runner {
  private readonly states = new Map<string, RunState>();
  readonly changes = new EventEmitter();

  constructor(
    private readonly store: Store,
    private readonly harness: Harness,
    private readonly options: { turnTimeoutMs: number; pollIntervalMs?: number } = {
      turnTimeoutMs: 30 * 60 * 1000,
    },
  ) {}

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

  /** Consume a turn stream to its end, folding as events arrive. */
  async consume(runId: string, stream: AsyncIterable<StreamEvent>): Promise<void> {
    const s = this.state(runId);
    let projection: Projection | null = null;
    const deadline = setTimeout(() => {
      s.events.push({
        type: "turn.done",
        id: `cujo-timeout-${Date.now()}`,
        createdAt: new Date().toISOString(),
        threadId: null,
        state: {
          status: "error",
          message: "turn timeout: no terminal event",
          completedAt: new Date().toISOString(),
        },
      });
      this.refold(runId);
    }, this.options.turnTimeoutMs);
    try {
      for await (const event of stream) {
        if (event.type === "model.message.delta") continue;
        if (event.type === "turn.created") s.subscribedTurnIds.add(event.turnId);
        s.events.push(event);
        projection = this.refold(runId);
      }
    } catch (error) {
      console.error(`run ${runId}: stream error`, error);
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
        this.state(run.id).events.push({
          type: "turn.done",
          id: `cujo-start-error-${Date.now()}`,
          createdAt: new Date().toISOString(),
          threadId: null,
          state: {
            status: "error",
            message: `could not start turn: ${String(error)}`,
            completedAt: new Date().toISOString(),
          },
        });
        this.refold(run.id);
      });
  }

  /** Contract 6 approve route. Rejects unless the run is blocked_pending. */
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
    this.stopPolling(runId);
    this.store.updateRun(runId, { approver, decidedAt: new Date().toISOString() });
    const stream = await this.harness.resume(
      view.run.sessionId,
      view.projection.approval,
      decision,
    );
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

  /** Rebuild from the session's persisted events after a restart. */
  async rehydrate(run: RunRecord): Promise<void> {
    const s = this.state(run.id);
    const items = await this.harness.listEvents(run.sessionId);
    // A run covers only the turns after the one started for its head SHA;
    // earlier turns belong to earlier runs of the same PR.
    const ownTurns = new Set(run.turnIds);
    const firstTurn = run.turnIds[0];
    let inScope = firstTurn === undefined;
    s.events = [];
    for (const item of items) {
      if (!inScope && item.turnId === firstTurn) inScope = true;
      if (!inScope) continue;
      s.events.push(item.event);
      ownTurns.add(item.turnId);
    }
    s.subscribedTurnIds = new Set(ownTurns);
    const projection = this.refold(run.id);
    const last = s.events.at(-1);
    if (projection.status === "running" && last && last.type !== "turn.done") {
      const turnId = projection.turnIds.at(-1);
      if (turnId) {
        void this.harness
          .subscribe(run.sessionId, turnId)
          .then((stream) => this.consume(run.id, stream));
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
