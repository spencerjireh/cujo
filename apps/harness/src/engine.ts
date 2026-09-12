/**
 * Sessions, turns and the gate: the part of the harness that is not pi.
 *
 * One pi `AgentSession` per turn, opened from the session's transcript and
 * disposed when the turn ends. A turn suspended on an approval keeps its
 * session alive with the model's tool call held inside `beforeToolCall`; the
 * answer arrives as the next turn's input and either lets the call run or
 * hands the model the deny reason as the tool result (decision 125). A new
 * user message on a session ends whatever runs there first, children
 * included: there is no wedge (decision 124).
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AgentSpec,
  type CancelReason,
  MAIN_THREAD,
  type ModelMessageEvent,
  type SessionEvent,
  type SessionEventItem,
  type StreamEvent,
  type ToolApprovalInput,
  type ToolApprovalRequiredEvent,
  type Turn,
  type TurnInputItem,
  type TurnMetrics,
  type TurnStateFinished,
} from "@cujo/harness-contract";
import { type Logger, errorFields } from "@cujo/log";
import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { MetricsAccumulator, isAssistant, mapEvent, modelMessageOf } from "./events";
import { newId, now } from "./ids";
import { type BridgeOptions, type BridgedServer, connectServer } from "./mcp";
import { type Models, thinkingLevelOf } from "./model";
import { openPiSession } from "./pi";
import type { Store } from "./store";
import { SUB_AGENT_TOOL, createSubAgentTool } from "./subagent";

export class HarnessError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

export interface EngineOptions {
  store: Store;
  models: Models;
  dataDir: string;
  log: Logger;
  /** Overridable so the tests bridge an in-process server without backoff. */
  connect?: (
    manifest: { name: string; url: string; description: string },
    options: BridgeOptions,
  ) => Promise<BridgedServer>;
}

/** A stream item: a stored event with its sequence number, or an ephemeral delta. */
export interface StreamItem {
  seq: number | null;
  turnId: string;
  event: StreamEvent;
}

interface Live {
  sessionId: string;
  spec: AgentSpec;
  session: AgentSession;
  servers: BridgedServer[];
  turnId: string;
  aborting: CancelReason | null;
  gate: { toolCallId: string; resolve: (result: BeforeToolCallResult | undefined) => void } | null;
  /** The call the gate held last, so its abort result is not mistaken for a response. */
  heldToolCallId: string | null;
  oneShotAllow: { toolName: string; args: unknown } | null;
  iterations: number;
  limitHit: boolean;
  metrics: MetricsAccumulator;
  sourceEvents: WeakMap<AssistantMessage, string>;
  lastMainMessage: ModelMessageEvent | null;
  /** Resolves once the turn's bookkeeping is done; awaited by cancel and supersede. */
  settled: Promise<void>;
  settle: () => void;
  /** pi's run of the prompt, started under the session lock so an abort always finds it. */
  run: Promise<void>;
}

type Listener = (item: StreamItem) => void;

export class Engine {
  private readonly live = new Map<string, Live>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly store: Store;
  private readonly models: Models;
  private readonly dataDir: string;
  private readonly log: Logger;
  private readonly connect: NonNullable<EngineOptions["connect"]>;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.models = options.models;
    this.dataDir = options.dataDir;
    this.log = options.log;
    this.connect = options.connect ?? connectServer;
    mkdirSync(this.cwd, { recursive: true });
  }

  /** An empty directory pi calls the working directory; nothing is read from it. */
  private get cwd(): string {
    return join(this.dataDir, "cwd");
  }

  /**
   * A turn that was running when the last process died is ended as an error
   * rather than a cancel: the fold treats a cancel as final, whereas an error
   * lets Cujo retry the turn once (decision 130). Pending approvals stay
   * pending; the re-call path answers them.
   */
  boot(): void {
    for (const turn of this.store.listRunningTurns()) {
      this.finishTurn(turn.sessionId, turn.id, {
        status: "error",
        completedAt: now(),
        message: "harness restarted",
      });
      this.log.warn("harness.turn.abandoned", { session_id: turn.sessionId, turn_id: turn.id });
    }
  }

  async close(): Promise<void> {
    for (const live of this.live.values()) await this.end(live, "client-cancelled");
  }

  /**
   * Turn creation, cancellation and the pi session's setup run one at a time
   * per session. Without this a second turn arriving while the first is still
   * opening its session would find nothing live and run alongside it.
   */
  private withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.locks.set(
      sessionId,
      run.catch(() => undefined),
    );
    return run;
  }

  // -- sessions -------------------------------------------------------------

  createSession(spec: AgentSpec): string {
    // Fail at creation, not at the first turn, when the model is unknown:
    // Cujo records the session id and would otherwise pin a dead one.
    this.models.resolve(spec.model.name, spec.model.params);
    for (const server of spec.mcpServers) {
      if (!this.store.getMcpServer(server.name)) {
        throw new HarnessError(400, `unknown MCP server "${server.name}"`);
      }
    }
    const id = newId();
    this.store.insertSession({
      id,
      spec,
      createdAt: now(),
      transcriptPath: join(this.dataDir, "sessions", id, "main.jsonl"),
    });
    return id;
  }

  listTurns(sessionId: string): Turn[] {
    this.requireSession(sessionId);
    return this.store.listTurns(sessionId);
  }

  listEvents(sessionId: string, afterSeq = 0): SessionEventItem[] {
    this.requireSession(sessionId);
    return this.store.listEvents(sessionId, afterSeq);
  }

  private requireSession(sessionId: string) {
    const row = this.store.getSession(sessionId);
    if (!row) throw new HarnessError(404, "no such session");
    return row;
  }

  // -- turns ----------------------------------------------------------------

  async createTurn(sessionId: string, input: TurnInputItem[]): Promise<string> {
    const session = this.requireSession(sessionId);
    const first = input[0];
    if (input.length !== 1 || !first) {
      throw new HarnessError(400, "a turn carries exactly one input item");
    }
    if (first.type === "user.message")
      return this.startUserTurn(session.id, session.spec, first.content);
    return this.resume(session.id, session.spec, first);
  }

  private startUserTurn(sessionId: string, spec: AgentSpec, content: string): Promise<string> {
    return this.withLock(sessionId, async () => {
      const live = this.live.get(sessionId);
      if (live) await this.end(live, "cancelled-for-next-turn");
      const turnId = this.insertTurn(sessionId, [{ type: "user.message", content }]);
      void this.runTurn(sessionId, spec, turnId, content, null);
      return turnId;
    });
  }

  private insertTurn(sessionId: string, input: TurnInputItem[]): string {
    const turnId = newId();
    const previous = this.store.lastTurn(sessionId);
    const createdAt = now();
    this.store.insertTurn({
      id: turnId,
      sessionId,
      createdAt,
      previousTurnId: previous?.id ?? null,
      input,
      state: { status: "running" },
    });
    this.emit(sessionId, turnId, {
      type: "turn.created",
      id: newId(),
      createdAt,
      threadId: MAIN_THREAD,
      turnId,
      previousTurnId: previous?.id ?? null,
      input,
    });
    return turnId;
  }

  /**
   * Opens the pi session for a fresh turn and runs the prompt. Everything the
   * model does from here lands in the event log through the listener; the
   * turn's end is decided at `agent_settled`.
   */
  private async runTurn(
    sessionId: string,
    spec: AgentSpec,
    turnId: string,
    prompt: string,
    oneShotAllow: Live["oneShotAllow"],
  ): Promise<void> {
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = () => resolve();
    });
    const started = Date.now();
    let live: Live | null = null;
    try {
      live = await this.withLock(sessionId, () =>
        this.openLive(sessionId, spec, turnId, prompt, oneShotAllow, settled, settle),
      );
      await live.run;
    } catch (error) {
      // Preflight failures (no model, no auth, an MCP server that never came
      // up) never reach `agent_settled`, so the turn ends here.
      this.log.error("harness.turn.failed", {
        session_id: sessionId,
        turn_id: turnId,
        duration_ms: Date.now() - started,
        ...errorFields(error),
      });
      const current = live ?? null;
      if (current && this.live.get(sessionId) === current) {
        this.finishLive(current, {
          status: "error",
          completedAt: now(),
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        this.finishTurn(sessionId, turnId, {
          status: "error",
          completedAt: now(),
          message: error instanceof Error ? error.message : String(error),
        });
        settle();
      }
    }
  }

  /**
   * Bridges the MCP servers, opens the pi session for one turn and starts the
   * prompt. Under the session lock, so by the time anything else can touch
   * the session the run exists and an abort reaches it.
   */
  private async openLive(
    sessionId: string,
    spec: AgentSpec,
    turnId: string,
    prompt: string,
    oneShotAllow: Live["oneShotAllow"],
    settled: Promise<void>,
    settle: () => void,
  ): Promise<Live> {
    const servers = await this.bridge(spec);
    const transcript = this.store.getSession(sessionId)?.transcriptPath;
    if (!transcript) throw new HarnessError(404, "no such session");
    mkdirSync(dirname(transcript), { recursive: true });
    const sessionManager = SessionManager.open(transcript, dirname(transcript), this.cwd);
    const partial = {
      sessionId,
      spec,
      servers,
      turnId,
      aborting: null,
      gate: null,
      heldToolCallId: null,
      oneShotAllow,
      iterations: 0,
      limitHit: false,
      metrics: new MetricsAccumulator(),
      sourceEvents: new WeakMap<AssistantMessage, string>(),
      lastMainMessage: null,
      settled,
      settle,
    };
    const model = this.models.resolve(spec.model.name, spec.model.params);
    const subAgent = createSubAgentTool({
      spec,
      model,
      thinkingLevel: thinkingLevelOf(spec.model.params?.reasoningEffort),
      models: this.models,
      cwd: this.cwd,
      agentDir: join(this.dataDir, "pi-agent"),
      tools: sandboxToolsOf(servers),
      emit: (event) => this.emit(sessionId, partial.turnId, event),
      stream: (event) => this.stream(sessionId, partial.turnId, event),
      addUsage: (message) => partial.metrics.add(message),
      log: this.log,
    });
    const session = await openPiSession({
      cwd: this.cwd,
      agentDir: join(this.dataDir, "pi-agent"),
      modelRuntime: this.models.runtime,
      model,
      thinkingLevel: thinkingLevelOf(spec.model.params?.reasoningEffort),
      systemPrompt: spec.instructions,
      tools: [...servers.flatMap((server) => server.tools), subAgent],
      sessionManager,
      compaction: spec.config.compaction.enabled,
    });
    const live: Live = { ...partial, session, run: Promise.resolve() };
    this.live.set(sessionId, live);
    this.installHooks(live);
    session.subscribe((event) => this.onEvent(live, event));
    this.log.info("harness.turn.started", { session_id: sessionId, turn_id: turnId });
    live.run = session.prompt(prompt, { expandPromptTemplates: false });
    // Observed by `runTurn`; this keeps a rejection before then from being unhandled.
    live.run.catch(() => undefined);
    return live;
  }

  private async bridge(spec: AgentSpec): Promise<BridgedServer[]> {
    const servers: BridgedServer[] = [];
    for (const ref of spec.mcpServers) {
      const manifest = this.store.getMcpServer(ref.name);
      if (!manifest) throw new HarnessError(400, `unknown MCP server "${ref.name}"`);
      servers.push(
        await this.connect(manifest, { gatedTools: ref.requireApprovalForTools, log: this.log }),
      );
    }
    return servers;
  }

  private installHooks(live: Live): void {
    const gated = new Set(live.spec.mcpServers.flatMap((server) => server.requireApprovalForTools));
    const agent = live.session.agent;
    const inner = agent.beforeToolCall;
    agent.beforeToolCall = async (ctx, signal) => {
      if (!gated.has(ctx.toolCall.name)) return inner?.(ctx, signal);
      return this.gate(live, ctx.toolCall, ctx.assistantMessage, signal);
    };
    agent.shouldStopAfterTurn = async () => {
      live.iterations += 1;
      if (live.iterations < live.spec.config.iterationLimit) return false;
      live.limitHit = true;
      return true;
    };
  }

  /**
   * The gate (decision 125). The tool call is held here, inside pi's
   * `beforeToolCall`, until the next turn answers it or the run is aborted.
   * The turn Cujo is following ends now, with the approval as its required
   * action; the answer starts a new turn on the same pi run.
   */
  private gate(
    live: Live,
    toolCall: { id: string; name: string; arguments: unknown },
    message: AssistantMessage,
    signal: AbortSignal | undefined,
  ): Promise<BeforeToolCallResult | undefined> {
    if (
      live.oneShotAllow &&
      live.oneShotAllow.toolName === toolCall.name &&
      stable(live.oneShotAllow.args) === stable(toolCall.arguments)
    ) {
      live.oneShotAllow = null;
      this.log.info("harness.gate.recalled", {
        session_id: live.sessionId,
        turn_id: live.turnId,
        tool: toolCall.name,
      });
      return Promise.resolve(undefined);
    }
    if (signal?.aborted) return Promise.resolve(undefined);
    const sourceEventId =
      live.sourceEvents.get(message) ??
      modelMessageOf(message, {
        threadId: MAIN_THREAD,
        serverOf: (name) => serverOf(live.servers, name),
        sourceEvents: live.sourceEvents,
      }).id;
    this.store.insertApproval({
      toolCallId: toolCall.id,
      sessionId: live.sessionId,
      turnId: live.turnId,
      toolName: toolCall.name,
      args: toolCall.arguments,
      sourceEventId,
    });
    const required: ToolApprovalRequiredEvent = {
      type: "tool.approval_required",
      id: newId(),
      createdAt: now(),
      threadId: MAIN_THREAD,
      toolCalls: [{ id: toolCall.id, sourceEventId }],
    };
    this.emit(live.sessionId, live.turnId, required);
    this.finishTurn(live.sessionId, live.turnId, {
      status: "done",
      completedAt: now(),
      output: live.lastMainMessage,
      requiredActions: [required],
      metrics: live.metrics.snapshot(),
    });
    this.log.info("harness.turn.suspended", {
      session_id: live.sessionId,
      turn_id: live.turnId,
      tool: toolCall.name,
    });
    live.heldToolCallId = toolCall.id;
    return new Promise((resolve) => {
      live.gate = { toolCallId: toolCall.id, resolve };
      signal?.addEventListener("abort", () => resolve(undefined), { once: true });
    });
  }

  private resume(sessionId: string, spec: AgentSpec, input: ToolApprovalInput): Promise<string> {
    return this.withLock(sessionId, async () => this.answer(sessionId, spec, input));
  }

  private async answer(
    sessionId: string,
    spec: AgentSpec,
    input: ToolApprovalInput,
  ): Promise<string> {
    const row = this.store.getApproval(input.toolCallId);
    if (!row || row.sessionId !== sessionId) throw new HarnessError(404, "no such approval");
    if (row.status !== "pending") {
      throw new HarnessError(409, `approval is ${row.status}`, { status: row.status });
    }
    const decision = input.approval.status === "allow" ? "allowed" : "denied";
    const live = this.live.get(sessionId);
    if (live?.gate && live.gate.toolCallId === input.toolCallId) {
      const gate = live.gate;
      live.gate = null;
      live.heldToolCallId = null;
      this.store.decideApproval(input.toolCallId, decision);
      const turnId = this.insertTurn(sessionId, [input]);
      live.turnId = turnId;
      this.log.info("harness.turn.resumed", {
        session_id: sessionId,
        turn_id: turnId,
        tool: row.toolName,
        decision: input.approval.status,
      });
      gate.resolve(
        input.approval.status === "allow"
          ? undefined
          : { block: true, reason: input.approval.reason },
      );
      return turnId;
    }
    if (live) {
      // A pending row with a live session that is not holding it: the row is
      // stale by construction, since a new turn supersedes every pending one.
      throw new HarnessError(409, "approval is not held by the running turn", {
        status: "superseded",
      });
    }
    // The re-call path: the process that held the call is gone. The model is
    // told the outcome and, on allow, asked to make the same call again, which
    // the gate lets through once with identical arguments.
    this.store.decideApproval(input.toolCallId, decision);
    const transcript = this.store.getSession(sessionId)?.transcriptPath;
    if (!transcript) throw new HarnessError(404, "no such session");
    this.patchDanglingCall(transcript, row.toolCallId, row.toolName);
    const turnId = this.insertTurn(sessionId, [input]);
    const prompt =
      input.approval.status === "allow"
        ? `The operator approved your ${row.toolName} call ${row.toolCallId}. Call it again now with exactly the same arguments.`
        : `The operator rejected your ${row.toolName} call ${row.toolCallId}: ${input.approval.reason}`;
    this.log.info("harness.turn.recalled", {
      session_id: sessionId,
      turn_id: turnId,
      tool: row.toolName,
      decision: input.approval.status,
    });
    void this.runTurn(
      sessionId,
      spec,
      turnId,
      prompt,
      input.approval.status === "allow" ? { toolName: row.toolName, args: row.args } : null,
    );
    return turnId;
  }

  /**
   * A call that was awaiting approval when the process died has no result in
   * the transcript unless pi's abort ran first. pi-ai patches a dangling call
   * at request time anyway; this gives the model the true story instead of
   * "No result provided".
   */
  private patchDanglingCall(transcript: string, toolCallId: string, toolName: string): void {
    const manager = SessionManager.open(transcript, dirname(transcript), this.cwd);
    const answered = manager
      .buildSessionContext()
      .messages.some(
        (message) => message.role === "toolResult" && message.toolCallId === toolCallId,
      );
    if (answered) return;
    manager.appendMessage({
      role: "toolResult",
      toolCallId,
      toolName,
      content: [
        {
          type: "text",
          text: "The harness restarted while this call awaited approval. Wait for the next user message.",
        },
      ],
      isError: true,
      timestamp: Date.now(),
    });
  }

  cancel(sessionId: string): Promise<void> {
    this.requireSession(sessionId);
    return this.withLock(sessionId, async () => {
      const live = this.live.get(sessionId);
      if (live) await this.end(live, "client-cancelled");
    });
  }

  /** Ends a live turn: aborts pi (which releases a held gate), then waits for settlement. */
  private async end(live: Live, reason: CancelReason): Promise<void> {
    if (this.live.get(live.sessionId) !== live) return;
    live.aborting = reason;
    const superseded = this.store.supersedePendingApprovals(live.sessionId);
    if (superseded) {
      this.log.info("harness.approval.superseded", {
        session_id: live.sessionId,
        turn_id: live.turnId,
        reason,
      });
    }
    await live.session.abort();
    await live.settled;
  }

  // -- the listener ---------------------------------------------------------

  private onEvent(live: Live, event: AgentSessionEvent): void {
    // A held call released by an abort gets pi's "Operation aborted" result.
    // It never ran, and the fold reads a response to the gated call as the
    // review having posted, so that one is not a `tool.response`.
    if (
      event.type === "tool_execution_end" &&
      live.aborting &&
      event.toolCallId === live.heldToolCallId
    ) {
      return;
    }
    const mapped = mapEvent(event, {
      threadId: MAIN_THREAD,
      serverOf: (name) => serverOf(live.servers, name),
      sourceEvents: live.sourceEvents,
    });
    for (const item of mapped) {
      if (item.kind === "store") {
        if (item.event.type === "model.message") live.lastMainMessage = item.event;
        this.emit(live.sessionId, live.turnId, item.event);
      } else {
        this.stream(live.sessionId, live.turnId, item.event);
      }
    }
    switch (event.type) {
      case "message_end":
        if (isAssistant(event.message)) live.metrics.add(event.message);
        break;
      case "auto_retry_start":
        this.log.warn("harness.retry.scheduled", {
          session_id: live.sessionId,
          turn_id: live.turnId,
          attempt: event.attempt,
          delay_ms: event.delayMs,
          error_message: event.errorMessage,
        });
        break;
      case "compaction_end":
        this.log.info("harness.compaction.finished", {
          session_id: live.sessionId,
          turn_id: live.turnId,
          reason: event.reason,
        });
        break;
      case "agent_settled":
        this.settleLive(live);
        break;
      default:
        break;
    }
  }

  /** `agent_settled`: the pi run is over. Decide how the current turn ended. */
  private settleLive(live: Live): void {
    const last = [...live.session.messages].reverse().find(isAssistant);
    let state: TurnStateFinished;
    if (live.aborting) {
      state = {
        status: "cancelled",
        completedAt: now(),
        reason: live.aborting,
        metrics: live.metrics.snapshot(),
      };
    } else if (last?.stopReason === "error") {
      state = {
        status: "error",
        completedAt: now(),
        message: last.errorMessage ?? "model error",
        metrics: live.metrics.snapshot(),
      };
    } else if (live.limitHit) {
      state = {
        status: "error",
        completedAt: now(),
        message: `iteration limit ${live.spec.config.iterationLimit} reached`,
        metrics: live.metrics.snapshot(),
      };
    } else {
      state = {
        status: "done",
        completedAt: now(),
        output: live.lastMainMessage,
        requiredActions: [],
        metrics: live.metrics.snapshot(),
      };
    }
    this.finishLive(live, state);
  }

  private finishLive(live: Live, state: TurnStateFinished): void {
    // A turn already ended by the gate (done, with a required action) keeps
    // that state: the abort that follows a cancel is not a second ending.
    const turn = this.store.getTurn(live.turnId);
    if (turn?.state.status === "running") this.finishTurn(live.sessionId, live.turnId, state);
    this.log.info("harness.turn.finished", {
      session_id: live.sessionId,
      turn_id: live.turnId,
      status: state.status,
    });
    if (this.live.get(live.sessionId) === live) this.live.delete(live.sessionId);
    live.session.dispose();
    for (const server of live.servers) void server.close().catch(() => undefined);
    live.settle();
  }

  private finishTurn(sessionId: string, turnId: string, state: TurnStateFinished): void {
    this.store.setTurnState(turnId, state);
    this.emit(sessionId, turnId, {
      type: "turn.done",
      id: newId(),
      createdAt: state.completedAt,
      threadId: MAIN_THREAD,
      state,
    });
  }

  // -- the event log and its subscribers -----------------------------------

  private emit(sessionId: string, turnId: string, event: SessionEvent): void {
    const item = this.store.appendEvent(sessionId, turnId, event);
    this.fanOut(sessionId, { seq: item.seq, turnId, event });
  }

  private stream(sessionId: string, turnId: string, event: StreamEvent): void {
    this.fanOut(sessionId, { seq: null, turnId, event });
  }

  private fanOut(sessionId: string, item: StreamItem): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) listener(item);
  }

  /**
   * Replays the turn's stored events, then tails the live log until the
   * turn's `turn.done`, then closes. A subscriber attaches before replaying so
   * nothing that lands in between is missed; the sequence number dedups.
   */
  subscribe(sessionId: string, turnId: string): AsyncIterable<StreamEvent> {
    this.requireSession(sessionId);
    const turn = this.store.getTurn(turnId);
    if (!turn || turn.sessionId !== sessionId) throw new HarnessError(404, "no such turn");
    const queue: StreamItem[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const listener: Listener = (item) => {
      if (item.turnId !== turnId) return;
      queue.push(item);
      wake?.();
    };
    const attach = () => {
      let set = this.listeners.get(sessionId);
      if (!set) {
        set = new Set();
        this.listeners.set(sessionId, set);
      }
      set.add(listener);
    };
    const detach = () => {
      const set = this.listeners.get(sessionId);
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(sessionId);
    };
    const store = this.store;
    return {
      async *[Symbol.asyncIterator]() {
        attach();
        try {
          let lastSeq = 0;
          for (const item of store.listTurnEvents(sessionId, turnId)) {
            lastSeq = item.seq;
            yield item.event;
            if (item.event.type === "turn.done") return;
          }
          while (!closed) {
            const next = queue.shift();
            if (!next) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = null;
              continue;
            }
            if (next.seq !== null && next.seq <= lastSeq) continue;
            if (next.seq !== null) lastSeq = next.seq;
            yield next.event;
            if (next.event.type === "turn.done") closed = true;
          }
        } finally {
          closed = true;
          detach();
        }
      },
    };
  }
}

function serverOf(servers: BridgedServer[], toolName: string): string | undefined {
  return servers.find((server) => server.tools.some((tool) => tool.name === toolName))?.name;
}

/** The tools a sub-agent may use: every bridged server except github-mcp, and no sub-agents. */
function sandboxToolsOf(servers: BridgedServer[]): ToolDefinition[] {
  return servers
    .filter((server) => server.name !== "github-mcp")
    .flatMap((server) => server.tools)
    .filter((tool) => tool.name !== SUB_AGENT_TOOL);
}

/** JSON with sorted keys, so two argument objects compare by value. */
export function stable(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export type { TurnMetrics };
