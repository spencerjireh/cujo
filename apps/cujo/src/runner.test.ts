import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it, vi } from "vitest";
import { Runner } from "./runner";
import { Store } from "./store";
import type { Harness, StreamEvent } from "./trueforge";
import type { RunRecord } from "./types";

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

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    repo: "o/r",
    prNumber: 1,
    headSha: "h",
    sessionId: "s",
    turnIds: [],
    status: "running",
    approver: null,
    decidedAt: null,
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
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    let seenAtFirstEvent: string[] = [];
    async function* stream(): AsyncIterable<StreamEvent> {
      seenAtFirstEvent = store.getRun(r.id)?.turnIds ?? [];
      yield turnCreated("t1", null, "2026-08-27T10:00:01Z");
      yield reviewCall("c1");
      yield turnDone("t1");
    }
    const startTurn = vi.fn(async () => ({ turnId: "t1", stream: stream() }));
    const runner = new Runner(store, { startTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledWith("s", "review it");
    expect(seenAtFirstEvent).toEqual(["t1"]);
    expect(store.getRun(r.id)).toMatchObject({ status: "clean", turnIds: ["t1"] });
  });

  it("ends the run in error, with no turn, when the harness refuses the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const startTurn = vi.fn(async () => {
      throw new Error("harness down");
    });
    const runner = new Runner(store, { startTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.start(r, "review it");
    expect(store.getRun(r.id)).toMatchObject({ status: "error", turnIds: [] });
    expect(store.getProjection(r.id)?.error).toContain("harness down");
  });
});

describe("Runner.supersede", () => {
  it("moves a blocked run to superseded and refuses a decision on it", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const resume = vi.fn();
    const runner = new Runner(store, { resume } as unknown as Harness, { turnTimeoutMs: 10_000 });
    await runner.consume(
      r.id,
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        approvalRequired("c1"),
        turnDone("t1"),
      ]),
    );
    expect(store.getRun(r.id)?.status).toBe("blocked_pending");
    runner.supersede(r.id);
    expect(store.getRun(r.id)?.status).toBe("superseded");
    expect(store.getProjection(r.id)?.status).toBe("superseded");
    const decision = await runner.approve(r.id, "allow", "a@x");
    expect(decision.ok).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    runner.stopAll();
  });
});

describe("Runner.rehydrate", () => {
  it("ends a run that has no recorded turn instead of guessing from the session", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const listEvents = vi.fn();
    const runner = new Runner(store, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.rehydrate(r);
    expect(listEvents).not.toHaveBeenCalled();
    expect(store.getRun(r.id)?.status).toBe("error");
    // The head can be claimed again by a redelivery.
    expect(
      store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" }).created,
    ).toBe(true);
  });

  it("replays only its own chain when another run shares the session", async () => {
    const store = new Store(":memory:");
    const a = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h1", sessionId: "s" }).run;
    const b = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h2", sessionId: "s" }).run;
    store.updateRun(a.id, { turnIds: ["t1"] });
    store.updateRun(b.id, { turnIds: ["t2"] });
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T09:00:00Z") },
      { turnId: "t1", event: approvalRequired("c1") },
      { turnId: "t1", event: turnDone("t1") },
      // Run b's turn chains from a's last turn because the session is shared.
      { turnId: "t2", event: turnCreated("t2", "t1", "2026-08-27T11:00:00Z") },
      { turnId: "t2", event: reviewCall("c2") },
      { turnId: "t2", event: turnDone("t2") },
    ]);
    const runner = new Runner(store, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.rehydrate(store.updateRun(a.id, {}) as RunRecord);
    expect(store.getRun(a.id)).toMatchObject({ status: "blocked_pending", turnIds: ["t1"] });
    runner.stopAll();
  });
});

describe("Runner.consume", () => {
  it("resubscribes after a dropped stream and finishes the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const events: StreamEvent[] = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const subscribe = vi.fn(async () => streamOf(events));
    const harness = { subscribe } as unknown as Harness;
    const runner = new Runner(store, harness, { turnTimeoutMs: 10_000, retryDelaysMs: [0] });
    await runner.consume(r.id, streamOf(events, 1));
    expect(subscribe).toHaveBeenCalledWith("s", "t1");
    expect(store.getRun(r.id)?.status).toBe("clean");
  });

  it("ends the run in error when every resubscribe fails", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const subscribe = vi.fn(async () => {
      throw new Error("still down");
    });
    const runner = new Runner(store, { subscribe } as unknown as Harness, {
      turnTimeoutMs: 10_000,
      retryDelaysMs: [0, 0],
    });
    await runner.consume(
      r.id,
      streamOf([turnCreated("t1", null, "2026-08-27T10:00:01Z"), reviewCall("c1")], 1),
    );
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(store.getRun(r.id)?.status).toBe("error");
    expect(store.getProjection(r.id)?.error).toBe("turn stream lost");
  });
});

describe("Runner.approve", () => {
  async function blocked() {
    const store = new Store(":memory:");
    const { run: r } = store.createRun({ repo: "o/r", prNumber: 1, headSha: "h", sessionId: "s" });
    const resume = vi.fn(async () => ({ turnId: "t2", stream: streamOf([]) }));
    const runner = new Runner(store, { resume } as unknown as Harness, { turnTimeoutMs: 10_000 });
    await runner.consume(
      r.id,
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        approvalRequired("c1"),
        turnDone("t1"),
      ]),
    );
    expect(store.getRun(r.id)?.status).toBe("blocked_pending");
    return { store, runner, resume, id: r.id };
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
    expect(store.getRun(id)?.approver).toBeNull();
    const second = await runner.approve(id, "allow", "a@x");
    expect(second.ok).toBe(true);
    runner.stopAll();
  });

  it("records its own resume turn so the fold does not call it external", async () => {
    const { store, runner, resume, id } = await blocked();
    const approval: TrueForgeApi.TurnInputItem = {
      type: "user.tool_approval",
      threadId: "main",
      toolCallId: "c1",
      approval: { status: "allow" },
    };
    resume.mockResolvedValueOnce({
      turnId: "t2",
      stream: streamOf([turnCreated("t2", "t1", "2026-08-27T10:05:00Z", [approval])]),
    });
    expect((await runner.approve(id, "allow", "a@x")).ok).toBe(true);
    await vi.waitFor(() => expect(store.getRun(id)?.turnIds).toEqual(["t1", "t2"]));
    expect(store.listCujoTurns(id)).toEqual(["t2"]);
    expect(store.getProjection(id)?.externalResume).toBe(false);
    expect(store.getRun(id)?.approver).toBe("a@x");
    runner.stopAll();
  });
});
