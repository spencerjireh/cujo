import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it, vi } from "vitest";
import { type Harness, STALE_DENY_REASON, type StreamEvent } from "../../src/clients/trueforge";
import { ANY_RUN, type RunView, Runner } from "../../src/review/runner.service";
import type { RunRecord } from "../../src/review/types";
import { Store } from "../../src/store";

type Ev = TrueForgeApi.SessionEvent;

const turnCreated = (
  turnId: string,
  previousTurnId: string | null,
  createdAt: string,
  input?: TrueForgeApi.TurnInputItem[],
): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: null,
  turnId,
  previousTurnId,
  state: { status: "running" },
  ...(input ? { input } : {}),
});

const turnDone = (turnId: string): Ev => ({
  type: "turn.done",
  id: `td-${turnId}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: null,
  state: { status: "done", completedAt: "2026-08-27T00:00:00Z", output: null, requiredActions: [] },
});

const reviewCall = (id: string): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  toolCalls: [
    {
      id,
      type: "function",
      function: { name: "post_advisory_review", arguments: "{}" },
      toolInfo: {
        type: "mcp",
        mcpServerId: "x",
        mcpServerName: "github-mcp",
        originalToolName: "n",
      },
    } as unknown as TrueForgeApi.ToolCall,
  ],
});

const approvalRequired = (callId: string): Ev => ({
  type: "tool.approval_required",
  id: `ar-${callId}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  toolCalls: [{ id: callId, sourceEventId: "none" }],
});

/** The claim every test here makes; only the head SHA ever varies. */
const claim = (headSha = "h") => ({
  repo: "o/r",
  prNumber: 1,
  headSha,
  sessionId: "s",
  isPublic: true,
  deliveryId: null,
  model: null,
  rubricSha256: null,
});

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    repo: "o/r",
    prNumber: 1,
    headSha: "h",
    sessionId: "s",
    turnIds: [],
    deliveryId: null,
    prTitle: null,
    prAuthorLogin: null,
    prAuthorId: null,
    model: null,
    rubricSha256: null,
    status: "running",
    approver: null,
    decidedAt: null,
    isPublic: true,
    createdAt: "2026-08-27T10:00:00Z",
    updatedAt: "2026-08-27T10:00:00Z",
    ...overrides,
  };
}

async function* streamOf(events: StreamEvent[], failAfter?: number): AsyncIterable<StreamEvent> {
  let i = 0;
  for (const e of events) {
    if (failAfter !== undefined && i === failAfter) throw new Error("connection reset");
    i += 1;
    yield e;
  }
}

describe("Runner.selectRunEvents", () => {
  const items = [
    { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T09:00:00Z") },
    { turnId: "t1", event: turnDone("t1") },
    { turnId: "t2", event: turnCreated("t2", "t1", "2026-08-27T11:00:00Z") },
    { turnId: "t2", event: turnDone("t2") },
    { turnId: "t3", event: turnCreated("t3", "t2", "2026-08-27T12:00:00Z") },
  ];

  it("replays only the run's own turn chain", () => {
    const { events, turnIds } = Runner.selectRunEvents(run({ turnIds: ["t2"] }), items);
    expect([...turnIds]).toEqual(["t2", "t3"]);
    expect(events.map((e) => e.id)).toEqual(["tc-t2", "td-t2", "tc-t3"]);
  });

  it("adopts nothing when no turn was recorded, whatever the timestamps say", () => {
    const { events, turnIds } = Runner.selectRunEvents(run(), items);
    expect(events).toEqual([]);
    expect(turnIds.size).toBe(0);
  });

  it("skips a chained turn that another run on the session recorded as its own", () => {
    const { events, turnIds } = Runner.selectRunEvents(
      run({ turnIds: ["t2"] }),
      items,
      new Set(["t3"]),
    );
    expect([...turnIds]).toEqual(["t2"]);
    expect(events.map((e) => e.id)).toEqual(["tc-t2", "td-t2"]);
  });
});

describe("Runner.start", () => {
  it("records the turn id before the first event and folds to the end", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    let seenAtFirstEvent: string[] = [];
    async function* stream(): AsyncIterable<StreamEvent> {
      seenAtFirstEvent = store.runs.getRun(r.id)?.turnIds ?? [];
      yield turnCreated("t1", null, "2026-08-27T10:00:01Z");
      yield reviewCall("c1");
      yield turnDone("t1");
    }
    const startTurn = vi.fn(async () => "t1");
    const subscribe = vi.fn(async () => stream());
    const runner = new Runner(store.runs, { startTurn, subscribe } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledWith("s", "review it");
    expect(subscribe).toHaveBeenCalledWith("s", "t1");
    expect(seenAtFirstEvent).toEqual(["t1"]);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "clean", turnIds: ["t1"] });
  });

  it("tells a process-wide subscriber about every run, and survives one that throws", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const events = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => streamOf(events),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
    );
    const perRun: (RunView | null)[] = [];
    const anyRun: (RunView | null)[] = [];
    runner.changes.on(r.id, (v: RunView | null) => perRun.push(v));
    runner.changes.on(ANY_RUN, (v: RunView | null) => anyRun.push(v));
    // A subscriber must never be able to fail a run: emit() is synchronous and
    // would otherwise rethrow into the fold.
    runner.changes.on(ANY_RUN, () => {
      throw new Error("subscriber exploded");
    });
    await runner.start(r, "review it");
    expect(anyRun).toEqual(perRun);
    expect(anyRun.at(-1)?.run.status).toBe("clean");
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "clean" });
  });

  it("keeps the turn and resubscribes when the first subscribe fails", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const events = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const subscribe = vi.fn(async () => streamOf(events));
    let recordedBeforeSubscribe: string[] = [];
    subscribe.mockImplementationOnce(async () => {
      recordedBeforeSubscribe = store.runs.getRun(r.id)?.turnIds ?? [];
      throw new Error("subscribe failed");
    });
    const runner = new Runner(
      store.runs,
      { startTurn: async () => "t1", subscribe } as unknown as Harness,
      { turnTimeoutMs: 10_000, retryDelaysMs: [0] },
    );
    await runner.start(r, "review it");
    expect(recordedBeforeSubscribe).toEqual(["t1"]);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "clean", turnIds: ["t1"] });
  });

  it("does not create a turn for a run that is no longer running", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi.fn();
    const runner = new Runner(store.runs, { startTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.supersede(r.id);
    await runner.start(r, "review it");
    expect(startTurn).not.toHaveBeenCalled();
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
  });

  it("ends the run in error, with no turn, when the harness refuses the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi.fn(async () => {
      throw new Error("harness down");
    });
    const runner = new Runner(store.runs, { startTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.start(r, "review it");
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "error", turnIds: [] });
    expect(store.runs.getProjection(r.id)?.error).toContain("harness down");
  });

  /**
   * The session-level wedge: an approval nobody will decide is left pending,
   * and TrueForge refuses every later user message until it is answered.
   */
  it("clears a stale approval the session was holding, then starts the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi
      .fn()
      .mockRejectedValueOnce(new Error("422 user message cannot be sent"))
      .mockResolvedValueOnce("t2");
    const resume = vi.fn(async () => "t-deny");
    const cancelTurn = vi.fn(async () => {});
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:00Z") },
      { turnId: "t1", event: approvalRequired("c1") },
      { turnId: "t1", event: turnDone("t1") },
    ]);
    const runner = new Runner(
      store.runs,
      {
        startTurn,
        resume,
        cancelTurn,
        listEvents,
        // A review call, so the healed turn folds `clean`. Without one the
        // fold calls it "turn ended without a review", which is an error the
        // retry is right to act on — and this test is about the heal, not that.
        subscribe: async () => streamOf([reviewCall("c9"), turnDone("t2")]),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
    );

    await runner.start(r, "review it");

    expect(resume).toHaveBeenCalledWith(
      "s",
      expect.objectContaining({ toolCallId: "c1" }),
      "deny",
      STALE_DENY_REASON,
    );
    expect(startTurn).toHaveBeenCalledTimes(2);
    expect(store.runs.getRun(r.id)?.turnIds).toEqual(["t2"]);
    runner.stopAll();
  });

  it("does not retry when the session holds no pending approval", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi.fn(async () => {
      throw new Error("harness down");
    });
    const resume = vi.fn();
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:00Z") },
      { turnId: "t1", event: turnDone("t1") },
    ]);
    const runner = new Runner(store.runs, { startTurn, resume, listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });

    await runner.start(r, "review it");

    expect(resume).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(store.runs.getProjection(r.id)?.error).toContain("harness down");
  });

  /** The guard that keeps the heal from answering for a human. */
  it.each(["blocked_pending", "running"] as const)(
    "refuses to heal while another run on the session is %s",
    async (status) => {
      const store = new Store(":memory:");
      const other = store.runs.createRun(claim("h1")).run;
      store.runs.updateRun(other.id, { status });
      const { run: r } = store.runs.createRun(claim("h2"));
      const startTurn = vi.fn(async () => {
        throw new Error("422 user message cannot be sent");
      });
      const resume = vi.fn();
      const listEvents = vi.fn();
      const runner = new Runner(
        store.runs,
        { startTurn, resume, listEvents } as unknown as Harness,
        { turnTimeoutMs: 10_000 },
      );

      await runner.start(r, "review it");

      expect(listEvents).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(startTurn).toHaveBeenCalledTimes(1);
      expect(store.runs.getRun(r.id)?.status).toBe("error");
      expect(store.runs.getRun(other.id)?.status).toBe(status);
    },
  );

  /**
   * `listEvents` is a network round trip. A run that crosses into the waiting
   * state while it is in flight owns the approval the read just found, so the
   * guard is re-checked before anything is denied.
   */
  it("refuses when a run becomes live while the session is being read", async () => {
    const store = new Store(":memory:");
    const other = store.runs.createRun(claim("h1")).run;
    store.runs.updateRun(other.id, { status: "clean" });
    const { run: r } = store.runs.createRun(claim("h2"));
    const startTurn = vi.fn(async () => {
      throw new Error("422 user message cannot be sent");
    });
    const resume = vi.fn();
    const listEvents = vi.fn(async () => {
      // The window the second check exists to close.
      store.runs.updateRun(other.id, { status: "blocked_pending" });
      return [
        { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:00Z") },
        { turnId: "t1", event: approvalRequired("c1") },
        { turnId: "t1", event: turnDone("t1") },
      ];
    });
    const runner = new Runner(store.runs, { startTurn, resume, listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });

    await runner.start(r, "review it");

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(store.runs.getRun(r.id)?.status).toBe("error");
  });
});

describe("Runner.supersede", () => {
  /** Drive a fresh run to blocked_pending on one pending approval. */
  async function blocked(store: Store, runner: Runner, headSha = "h") {
    const { run: r } = store.runs.createRun(claim(headSha));
    await runner.consume(
      r.id,
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        approvalRequired("c1"),
        turnDone("t1"),
      ]),
    );
    expect(store.runs.getRun(r.id)?.status).toBe("blocked_pending");
    return r;
  }

  it("answers the pending approval before cancelling, and refuses a decision after", async () => {
    const store = new Store(":memory:");
    const calls: string[] = [];
    const resume = vi.fn(async () => {
      calls.push("resume");
      return "t-deny";
    });
    const cancelTurn = vi.fn(async () => {
      calls.push("cancel");
    });
    const runner = new Runner(store.runs, { resume, cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    const r = await blocked(store, runner);

    await runner.supersede(r.id);

    // The deny is what stops the session refusing every later turn; the
    // cancel only stops the turn the deny starts.
    expect(calls).toEqual(["resume", "cancel"]);
    expect(resume).toHaveBeenCalledWith(
      "s",
      expect.objectContaining({ threadId: "main", toolCallId: "c1" }),
      "deny",
      STALE_DENY_REASON,
    );
    // Recorded as Cujo's own, so a replay never reads it as someone else's.
    expect(store.runs.listCujoTurns(r.id)).toEqual(["t-deny"]);
    // The run reads as replaced, not as one a human turned down.
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "superseded", approver: null });
    expect(store.runs.getProjection(r.id)?.status).toBe("superseded");

    const decision = await runner.approve(r.id, "allow", "a@x");
    expect(decision.ok).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
    runner.stopAll();
  });

  /**
   * `claimDecision` leaves the run `blocked_pending`, so an operator's resume
   * can be in flight and invisible to supersede. If it answered the approval
   * first, this deny fails — and its turn is now reviewing a commit nobody is
   * looking at, so the cancel still has to happen.
   */
  it("cancels anyway when the deny fails, so a decision that beat it cannot post", async () => {
    const store = new Store(":memory:");
    const resume = vi.fn(async () => {
      throw new Error("approval already answered");
    });
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(store.runs, { resume, cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    const r = await blocked(store, runner);

    await runner.supersede(r.id);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(cancelTurn).toHaveBeenCalledWith("s");
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
    runner.stopAll();
  });

  it("cancels once, not twice, when the deny lands", async () => {
    const store = new Store(":memory:");
    const resume = vi.fn(async () => "t-deny");
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(store.runs, { resume, cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    const r = await blocked(store, runner);

    await runner.supersede(r.id);

    expect(cancelTurn).toHaveBeenCalledTimes(1);
    runner.stopAll();
  });

  it("cancels without a deny when the run was never waiting on a human", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const resume = vi.fn();
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(store.runs, { resume, cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    store.runs.updateRun(r.id, { turnIds: ["t1"] });

    await runner.supersede(r.id);

    expect(resume).not.toHaveBeenCalled();
    expect(cancelTurn).toHaveBeenCalledWith("s");
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
  });

  it("sends no cancel for a run that has no turn, and survives a failed cancel", async () => {
    const store = new Store(":memory:");
    const a = store.runs.createRun(claim("h1")).run;
    const b = store.runs.createRun(claim("h2")).run;
    store.runs.updateRun(b.id, { turnIds: ["t2"] });
    const cancelTurn = vi.fn(async () => {
      throw new Error("no running turn");
    });
    const runner = new Runner(store.runs, { cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.supersede(a.id);
    expect(cancelTurn).not.toHaveBeenCalled();
    await runner.supersede(b.id);
    expect(cancelTurn).toHaveBeenCalledTimes(1);
    expect(store.runs.getRun(a.id)?.status).toBe("superseded");
    expect(store.runs.getRun(b.id)?.status).toBe("superseded");
  });
});

describe("Runner.rehydrate", () => {
  it("ends a run that has no recorded turn instead of guessing from the session", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const listEvents = vi.fn();
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.rehydrate(r);
    expect(listEvents).not.toHaveBeenCalled();
    expect(store.runs.getRun(r.id)?.status).toBe("error");
    // The head can be claimed again by a redelivery.
    expect(store.runs.createRun(claim("h")).created).toBe(true);
  });

  it("replays only its own chain when another run shares the session", async () => {
    const store = new Store(":memory:");
    const a = store.runs.createRun(claim("h1")).run;
    const b = store.runs.createRun(claim("h2")).run;
    store.runs.updateRun(a.id, { turnIds: ["t1"] });
    store.runs.updateRun(b.id, { turnIds: ["t2"] });
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T09:00:00Z") },
      { turnId: "t1", event: approvalRequired("c1") },
      { turnId: "t1", event: turnDone("t1") },
      // Run b's turn chains from a's last turn because the session is shared.
      { turnId: "t2", event: turnCreated("t2", "t1", "2026-08-27T11:00:00Z") },
      { turnId: "t2", event: reviewCall("c2") },
      { turnId: "t2", event: turnDone("t2") },
    ]);
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.rehydrate(store.runs.updateRun(a.id, {}) as RunRecord);
    expect(store.runs.getRun(a.id)).toMatchObject({ status: "blocked_pending", turnIds: ["t1"] });
    runner.stopAll();
  });
});

describe("Runner.hydrate", () => {
  it("reads the persisted model.message when the stream only carried a stub", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    const stub: StreamEvent = {
      type: "model.message",
      id: "mm-c1",
      createdAt: "2026-08-27T10:00:02Z",
      threadId: "main",
    };
    const full = reviewCall("c1");
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:01Z") },
      { turnId: "t1", event: full },
      // Another run's turn on the same session must not leak in.
      { turnId: "t9", event: { ...full, id: "mm-c1", threadId: "main" } },
      { turnId: "t1", event: turnDone("t1") },
    ]);
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.consume(
      r.id,
      streamOf([turnCreated("t1", null, "2026-08-27T10:00:01Z"), stub, turnDone("t1")]),
    );
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
    expect(store.runs.getProjection(r.id)?.review?.tool).toBe("post_advisory_review");
  });

  it("keeps the stream's events when the read fails", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const listEvents = vi.fn(async () => {
      throw new Error("server down");
    });
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.consume(
      r.id,
      streamOf([turnCreated("t1", null, "2026-08-27T10:00:01Z"), reviewCall("c1"), turnDone("t1")]),
    );
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
  });
});

describe("Runner.consume", () => {
  it("resubscribes after a dropped stream and finishes the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const events: StreamEvent[] = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const subscribe = vi.fn(async () => streamOf(events));
    const harness = { subscribe } as unknown as Harness;
    const runner = new Runner(store.runs, harness, { turnTimeoutMs: 10_000, retryDelaysMs: [0] });
    await runner.consume(r.id, streamOf(events, 1));
    expect(subscribe).toHaveBeenCalledWith("s", "t1");
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
  });

  it("resubscribes when the stream ends cleanly before the terminal event", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const events: StreamEvent[] = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const subscribe = vi.fn(async () => streamOf(events));
    const runner = new Runner(store.runs, { subscribe } as unknown as Harness, {
      turnTimeoutMs: 10_000,
      retryDelaysMs: [0],
    });
    // The first stream closes without error after one event, as the server
    // does when its subscribe window ends.
    await runner.consume(r.id, streamOf(events.slice(0, 1)));
    expect(subscribe).toHaveBeenCalledWith("s", "t1");
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
  });

  /**
   * A lost stream says nothing about the turn, so none of these end the run on
   * the stream's account. The verdict comes from what the turn actually did,
   * read back from the session; the watchdog is the only bound.
   */
  describe("when every resubscribe fails", () => {
    const persisted = (events: Ev[]) => events.map((event) => ({ turnId: "t1", event }));
    const lost = (harness: Partial<Record<string, unknown>>, turnTimeoutMs = 10_000) => {
      const store = new Store(":memory:");
      const { run: r } = store.runs.createRun(claim());
      const subscribe = vi.fn(async () => {
        throw new Error("still down");
      });
      const cancelTurn = vi.fn(async () => {});
      const runner = new Runner(
        store.runs,
        { subscribe, cancelTurn, ...harness } as unknown as Harness,
        { turnTimeoutMs, retryDelaysMs: [0, 0], pollIntervalMs: 1 },
      );
      const opening = streamOf(
        [turnCreated("t1", null, "2026-08-27T10:00:01Z"), reviewCall("c1")],
        1,
      );
      return { store, r, runner, subscribe, cancelTurn, opening };
    };

    it("waits for the turn, then folds the verdict it really reached", async () => {
      const whole = [
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        reviewCall("c1"),
        turnDone("t1"),
      ];
      const { store, r, runner, subscribe, opening } = lost({
        listTurns: vi.fn(async () => [{ id: "t1", state: { status: "done" } }]),
        listEvents: vi.fn(async () => persisted(whole)),
      });
      await runner.consume(r.id, opening);
      expect(subscribe).toHaveBeenCalledTimes(2);
      // Not "turn stream lost": the turn posted its review, and it says so.
      expect(store.runs.getRun(r.id)?.status).toBe("clean");
      expect(store.runs.getProjection(r.id)?.error).toBeNull();
    });

    it("reports a real failure as the turn's own, not the stream's", async () => {
      const failed: Ev = {
        id: "td-t1",
        type: "turn.done",
        createdAt: "2026-08-27T10:00:09Z",
        threadId: null,
        state: { status: "error", message: "provider exploded" },
      } as unknown as Ev;
      const { store, r, runner, opening } = lost({
        listTurns: vi.fn(async () => [{ id: "t1", state: { status: "error" } }]),
        listEvents: vi.fn(async () =>
          persisted([turnCreated("t1", null, "2026-08-27T10:00:01Z"), failed]),
        ),
      });
      await runner.consume(r.id, opening);
      expect(store.runs.getRun(r.id)?.status).toBe("error");
      expect(store.runs.getProjection(r.id)?.error).toContain("provider exploded");
    });

    it("keeps waiting while the turn is still running, and lets the watchdog end it", async () => {
      const listTurns = vi.fn(async () => [{ id: "t1", state: { status: "running" } }]);
      const { store, r, runner, cancelTurn, opening } = lost(
        { listTurns, listEvents: vi.fn(async () => []) },
        150,
      );
      await runner.consume(r.id, opening);
      expect(listTurns).toHaveBeenCalled();
      // The watchdog ended it, so the error names the timeout and not the
      // stream -- and it cancelled the turn it chose to abandon.
      expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
      expect(cancelTurn).toHaveBeenCalledWith("s");
    });

    it("ends a run that has no turn to watch, rather than leaving it running", async () => {
      // The watchdog is cleared when `consume` returns, so a path that waits on
      // nothing would strand the run at `running` with nobody left to end it --
      // the one failure the synthetic terminal was there to prevent.
      const { store, r, runner } = lost({ listTurns: vi.fn(), listEvents: vi.fn() });
      await runner.consume(r.id, streamOf([reviewCall("c1")], 0));
      expect(store.runs.getRun(r.id)?.status).toBe("error");
      expect(store.runs.getProjection(r.id)?.error).toBe("run lost before its turn started");
    });

    it("survives a session it cannot read, rather than calling that a failure", async () => {
      const { store, r, runner, opening } = lost(
        {
          listTurns: vi.fn(async () => {
            throw new Error("harness down");
          }),
          listEvents: vi.fn(async () => {
            throw new Error("harness down");
          }),
        },
        150,
      );
      await runner.consume(r.id, opening);
      // Still the watchdog's verdict, never "turn stream lost".
      expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
    });
  });
});

describe("Runner.approve", () => {
  async function blocked() {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const resume = vi.fn(async () => "t2");
    const subscribe = vi.fn(async () => streamOf([]));
    const runner = new Runner(store.runs, { resume, subscribe } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.consume(
      r.id,
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        approvalRequired("c1"),
        turnDone("t1"),
      ]),
    );
    expect(store.runs.getRun(r.id)?.status).toBe("blocked_pending");
    return { store, runner, resume, subscribe, id: r.id };
  }

  it("resumes once and rejects a second decision", async () => {
    const { runner, resume, id } = await blocked();
    const [a, b] = await Promise.all([
      runner.approve(id, "allow", "a@x"),
      runner.approve(id, "deny", "b@x"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the resume never reaches the harness", async () => {
    const { store, runner, resume, id } = await blocked();
    resume.mockRejectedValueOnce(new Error("harness down"));
    const first = await runner.approve(id, "allow", "a@x");
    expect(first.ok).toBe(false);
    expect(store.runs.getRun(id)?.approver).toBeNull();
    const second = await runner.approve(id, "allow", "a@x");
    expect(second.ok).toBe(true);
    runner.stopAll();
  });

  it("records its own resume turn so the fold does not call it external", async () => {
    const { store, runner, subscribe, id } = await blocked();
    const approval: TrueForgeApi.TurnInputItem = {
      type: "user.tool_approval",
      threadId: "main",
      toolCallId: "c1",
      approval: { status: "allow" },
    };
    let recordedBeforeSubscribe: string[] = [];
    subscribe.mockImplementationOnce(async () => {
      recordedBeforeSubscribe = store.runs.listCujoTurns(id);
      return streamOf([turnCreated("t2", "t1", "2026-08-27T10:05:00Z", [approval])]);
    });
    expect((await runner.approve(id, "allow", "a@x")).ok).toBe(true);
    await vi.waitFor(() => expect(recordedBeforeSubscribe).toEqual(["t2"]));
    await vi.waitFor(() => expect(store.runs.getRun(id)?.turnIds).toEqual(["t1", "t2"]));
    expect(store.runs.listCujoTurns(id)).toEqual(["t2"]);
    expect(store.runs.getProjection(id)?.externalResume).toBe(false);
    expect(store.runs.getRun(id)?.approver).toBe("a@x");
    runner.stopAll();
  });
});

describe("Runner retries a turn that posted nothing", () => {
  const errorDone = (turnId: string): Ev => ({
    type: "turn.done",
    id: `td-${turnId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId: null,
    state: { status: "error", message: "model down", completedAt: "2026-08-27T00:00:00Z" },
  });

  const cancelledDone = (turnId: string): Ev => ({
    type: "turn.done",
    id: `td-${turnId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId: null,
    state: { status: "cancelled", reason: "client-cancelled", completedAt: "2026-08-27T00:00:00Z" },
  });

  /** A runner whose stream is chosen per `startTurn` call. */
  function runnerOver(streams: Ev[][], options = {}) {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    let attempt = 0;
    const startTurn = vi.fn(async () => `t${++attempt}`);
    const subscribe = vi.fn(async () => streamOf(streams[attempt - 1] ?? []));
    const runner = new Runner(store.runs, { startTurn, subscribe } as unknown as Harness, {
      turnTimeoutMs: 10_000,
      ...options,
    });
    return { store, r, runner, startTurn, subscribe };
  }

  it("starts one more turn, with the same message, and folds the second one", async () => {
    const { store, r, runner, startTurn } = runnerOver([
      [turnCreated("t1", null, "2026-08-27T10:00:01Z"), errorDone("t1")],
      [turnCreated("t2", "t1", "2026-08-27T10:05:00Z"), reviewCall("c1"), turnDone("t2")],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(2);
    expect(startTurn).toHaveBeenNthCalledWith(2, "s", "review it");
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "clean" });
  });

  it("spends the retry once, however the second turn ends", async () => {
    const { store, r, runner, startTurn } = runnerOver([
      [turnCreated("t1", null, "2026-08-27T10:00:01Z"), errorDone("t1")],
      [turnCreated("t2", "t1", "2026-08-27T10:05:00Z"), errorDone("t2")],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(2);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "error" });
  });

  it("leaves a cancelled turn alone, because somebody stopped it on purpose", async () => {
    // The fold flattens `cancelled` into `error` with the reason in prose, so
    // this has to be read off the event rather than matched in that sentence.
    const { store, r, runner, startTurn } = runnerOver([
      [turnCreated("t1", null, "2026-08-27T10:00:01Z"), cancelledDone("t1")],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "error" });
  });

  it("does not retry once a review has reached the pull request", async () => {
    // An advisory review posts the moment the model calls it, so a second turn
    // would be a second review on the same head.
    const { r, runner, startTurn } = runnerOver([
      [
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        reviewCall("c1"),
        turnDone("t1"),
        errorDone("t1b"),
      ],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a run a newer head superseded", async () => {
    const { r, runner, startTurn } = runnerOver([
      [turnCreated("t1", null, "2026-08-27T10:00:01Z"), errorDone("t1")],
    ]);
    await runner.supersede(r.id);
    await runner.start(r, "review it");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("does not retry a watchdog timeout, which already spent the turn budget", async () => {
    // The synthetic terminal Cujo injects itself. Retrying it costs another
    // full turn timeout for a run that was already too slow.
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi.fn(async () => "t1");
    async function* hangs(): AsyncIterable<StreamEvent> {
      yield turnCreated("t1", null, "2026-08-27T10:00:01Z");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const runner = new Runner(
      store.runs,
      { startTurn, subscribe: async () => hangs() } as unknown as Harness,
      { turnTimeoutMs: 5 },
    );
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "error" });
  });
});

describe("Runner.supersede reports whether the turn is confirmed stopped", () => {
  // `/cujo review` deletes the run's row on the strength of this answer, and a
  // live turn with no row can still post a review. A resolved promise is not
  // the same as a cancelled turn.
  function superseding(cancelTurn: () => Promise<void>) {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => streamOf([turnCreated("t1", null, "2026-08-27T10:00:01Z")]),
        cancelTurn,
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
    );
    return { store, r, runner };
  }

  it("says yes when the harness cancels the turn", async () => {
    const { store, r, runner } = superseding(async () => {});
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    expect(await runner.supersede(r.id)).toBe(true);
  });

  it("says no when the harness refuses, even though it still supersedes", async () => {
    // The failure this exists for: `supersede` swallows the error on purpose —
    // an unreachable harness is not worth failing a supersession over — so the
    // caller has to be told rather than left to infer it from a resolved call.
    const { store, r, runner } = superseding(async () => {
      throw new Error("harness unreachable");
    });
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    expect(await runner.supersede(r.id)).toBe(false);
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
  });

  it("says yes for a run that never had a turn to cancel", async () => {
    const cancelTurn = vi.fn(async () => {});
    const { r, runner } = superseding(cancelTurn);
    expect(await runner.supersede(r.id)).toBe(true);
    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("says no on a second call, which cannot see whether the first cancel landed", async () => {
    const { store, r, runner } = superseding(async () => {});
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    expect(await runner.supersede(r.id)).toBe(true);
    expect(await runner.supersede(r.id)).toBe(false);
  });
});
