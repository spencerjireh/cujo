import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionEvent, TurnInputItem } from "@cujo/harness-contract";
import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { Harness, StreamEvent } from "../../src/clients/harness";
import { emptyProjection } from "../../src/review/fold";
import { ANY_RUN, type RunView, Runner } from "../../src/review/runner.service";
import type { RunRecord } from "../../src/review/types";
import { Store } from "../../src/store";

type Ev = SessionEvent;

const turnCreated = (
  turnId: string,
  previousTurnId: string | null,
  createdAt: string,
  input?: TurnInputItem[],
): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: "main",
  turnId,
  previousTurnId,
  input: input ?? [],
});

const turnDone = (turnId: string): Ev => ({
  type: "turn.done",
  id: `td-${turnId}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  state: { status: "done", completedAt: "2026-08-27T00:00:00Z", output: null, requiredActions: [] },
});

const reviewCall = (id: string): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  content: null,
  toolCalls: [
    {
      id,
      type: "function",
      function: { name: "post_advisory_review", arguments: "{}" },
      toolInfo: { type: "mcp", name: "post_advisory_review", serverName: "github-mcp" },
    },
  ],
});

/**
 * GitHub's answer to that call. A review is recorded from its response, not
 * its call (decision 140), so a fixture that means "a review posted" carries
 * both.
 */
const reviewPosted = (id: string, isError = false): Ev => ({
  type: "tool.response",
  id: `tr-${id}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  toolCallId: id,
  toolName: "post_advisory_review",
  content: isError ? "GitHub 422: Review cannot be requested" : "{}",
  isError,
});

const approvalRequired = (callId: string): Ev => ({
  type: "tool.approval_required",
  id: `ar-${callId}`,
  createdAt: "2026-08-27T00:00:00Z",
  threadId: "main",
  toolCalls: [{ id: callId, sourceEventId: "none" }],
});

/**
 * A check that reported. Runs in this file are about the Runner's plumbing
 * rather than the status ladder, but a review with no check behind it folds
 * `unproven` rather than `clean` (decision 107), so a fixture that means to
 * describe a finished review has to carry one.
 */
const checkReported = (title: string, threadId = `th-${title}`): Ev[] => [
  {
    type: "thread.created",
    id: `thc-${threadId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId,
    title,
    parent: { threadId: "main", toolCallId: "spawn" },
    agentInfo: { type: "dynamic", name: title, input: "" },
  },
  {
    type: "thread.done",
    id: `thd-${threadId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId,
    title,
    parent: { threadId: "main", toolCallId: "spawn" },
    state: {
      status: "done",
      output: {
        type: "model.message",
        id: `out-${threadId}`,
        createdAt: "2026-08-27T00:00:00Z",
        threadId,
        content: `\`\`\`json\n{"check":"${title}"}\n\`\`\``,
      },
    },
  },
];

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
  mode: "sandbox",
  budgetTokens: null,
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
    mode: "sandbox",
    budgetTokens: null,
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
      for (const event of checkReported("tests")) yield event as StreamEvent;
      yield reviewCall("c1");
      yield reviewPosted("c1");
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
      ...checkReported("tests"),
      reviewCall("c1"),
      reviewPosted("c1"),
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
      ...checkReported("tests"),
      reviewCall("c1"),
      reviewPosted("c1"),
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

  it("ends the run in error on the first refused turn, with no heal (decision 138)", async () => {
    // Nothing is gated, so no session holds an approval to clear; a refused
    // turn is a refused turn and the run says so once.
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const startTurn = vi.fn(async () => {
      throw new Error("422 user message cannot be sent");
    });
    const listEvents = vi.fn();
    const runner = new Runner(store.runs, { startTurn, listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(listEvents).not.toHaveBeenCalled();
    expect(store.runs.getRun(r.id)?.status).toBe("error");
  });
});

describe("Runner.supersede", () => {
  it("cancels a live turn and marks the run superseded", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(store.runs, { cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    store.runs.updateRun(r.id, { turnIds: ["t1"] });

    await runner.supersede(r.id);

    expect(cancelTurn).toHaveBeenCalledWith("s");
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
  });

  it("moves a finished run without a cancel, and tells the subscribers (decision 138)", async () => {
    // A `blocked` run is done; `/cujo review` on its head supersedes it so
    // the card, the reaction and the check run hear that a newer run owns
    // the commit. No turn is live, so nothing is cancelled.
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"], status: "blocked" });
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(store.runs, { cancelTurn } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    const seen: string[] = [];
    runner.changes.on(ANY_RUN, (view: RunView | null) => {
      if (view) seen.push(view.run.status);
    });

    expect(await runner.supersede(r.id)).toBe(true);

    expect(cancelTurn).not.toHaveBeenCalled();
    expect(store.runs.getRun(r.id)?.status).toBe("superseded");
    expect(seen).toEqual(["superseded"]);
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
    // Cancel failed: the partial index still protects the head (decision 104).
    expect(store.runs.getRun(b.id)?.status).toBe("running");
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
      { turnId: "t2", event: reviewPosted("c2") },
      { turnId: "t2", event: turnDone("t2") },
    ]);
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.rehydrate(store.runs.updateRun(a.id, {}) as RunRecord);
    // Only t1 is a's; t2 chains from it but b recorded it. And a held call on
    // a spec that gates nothing is an error, not a wait (decision 138).
    expect(store.runs.getRun(a.id)).toMatchObject({ status: "error", turnIds: ["t1"] });
  });

  it("fires the watchdog immediately when the run has outlived its budget", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T09:00:00Z") },
    ]);
    const subscribe = vi.fn();
    const runner = new Runner(
      store.runs,
      { listEvents, subscribe, listTurns: vi.fn(async () => []) } as unknown as Harness,
      { turnTimeoutMs: 1000 },
    );
    // Backdate createdAt so the budget is already spent.
    const run = store.runs.getRun(r.id) as RunRecord;
    const old = new Date(Date.now() - 60_000).toISOString();
    const expired = { ...run, createdAt: old } as RunRecord;
    await runner.rehydrate(expired);
    expect(store.runs.getRun(r.id)?.status).toBe("error");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("passes the remaining budget to follow when the run is still within its window", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    const turnStartedAt = new Date(Date.now() - 200).toISOString();
    const hangingStream = async function* () {
      yield turnCreated("t1", null, turnStartedAt) as unknown as StreamEvent;
      await new Promise(() => {});
    };
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, turnStartedAt) },
    ]);
    const subscribe = vi.fn(async () => hangingStream());
    const runner = new Runner(
      store.runs,
      {
        listEvents,
        subscribe,
        listTurns: vi.fn(async () => []),
        cancelTurn: vi.fn(),
      } as unknown as Harness,
      { turnTimeoutMs: 500 },
    );
    // Turn was created 200ms ago — 300ms remaining. The watchdog should fire
    // within ~300ms, not a fresh 500ms.
    const run = store.runs.getRun(r.id) as RunRecord;
    await runner.rehydrate(run);
    // Give the watchdog time to fire (300ms remaining + margin).
    await new Promise((r) => setTimeout(r, 500));
    expect(store.runs.getRun(r.id)?.status).toBe("error");
  });
});

describe("Runner.hydrate", () => {
  it("replaces a streamed model.message with the persisted copy of the same id", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    const stub: StreamEvent = {
      type: "model.message",
      id: "mm-c1",
      createdAt: "2026-08-27T10:00:02Z",
      threadId: "main",
      content: null,
    };
    const full = reviewCall("c1");
    const listEvents = vi.fn(async () => [
      { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:01Z") },
      ...checkReported("tests").map((event) => ({ turnId: "t1", event })),
      { turnId: "t1", event: full },
      { turnId: "t1", event: reviewPosted("c1") },
      // Another run's turn on the same session must not leak in.
      { turnId: "t9", event: { ...full, id: "mm-c1", threadId: "main" } },
      { turnId: "t1", event: turnDone("t1") },
    ]);
    const runner = new Runner(store.runs, { listEvents } as unknown as Harness, {
      turnTimeoutMs: 10_000,
    });
    await runner.consume(
      r.id,
      // The check is in the stream as well as in the read-back: `hydrate`
      // refreshes events by id and never appends, so an event only `listEvents`
      // knows about would not reach the fold at all.
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        ...(checkReported("tests") as StreamEvent[]),
        stub,
        reviewPosted("c1"),
        turnDone("t1"),
      ]),
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
      streamOf([
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        ...(checkReported("tests") as StreamEvent[]),
        reviewCall("c1"),
        reviewPosted("c1"),
        turnDone("t1"),
      ]),
    );
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
  });
});

/**
 * What a timed-out run tells the pull request (decision 109).
 *
 * The run keeps `status: "error"` — Cujo did fall over — and the change is that
 * the author stops seeing nothing. Runs `b5724912`, `c7bf0e13` and `ced0c934`
 * each gave a pull request half an hour of silence with completed reports in
 * hand.
 */
describe("Runner, on a turn that timed out", () => {
  /** Opens the turn and then stops yielding, so only the watchdog can end it. */
  async function* hangsAfterOpening(): AsyncIterable<StreamEvent> {
    yield turnCreated("t1", null, "2026-08-27T10:00:01Z");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  function timingOut(createComment = vi.fn(async () => 7)) {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    // The whole turn as the session holds it: `tests` reported, nothing else
    // did, and no review tool was ever called.
    const whole = [turnCreated("t1", null, "2026-08-27T10:00:01Z"), ...checkReported("tests")];
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        // A stream that opens and then hangs, so only the watchdog ends it.
        subscribe: async () => hangsAfterOpening(),
        listEvents: vi.fn(async () => whole.map((event) => ({ turnId: "t1", event }))),
        listTurns: vi.fn(async () => [{ id: "t1", state: { status: "running" } }]),
        cancelTurn: vi.fn(async () => {}),
      } as unknown as Harness,
      { turnTimeoutMs: 5, retryDelaysMs: [0], pollIntervalMs: 1, links: { publicBaseUrl: "" } },
      undefined,
      { createComment } as unknown as never,
    );
    return { store, r, runner, createComment };
  }

  it("posts what the turn did measure, instead of nothing", async () => {
    const { store, r, runner, createComment } = timingOut();
    await runner.start(r, "review it");
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(createComment).toHaveBeenCalledWith(
      "o/r",
      1,
      expect.stringContaining("did not finish this review"),
    );
    expect(createComment).toHaveBeenCalledWith(
      "o/r",
      1,
      expect.stringContaining("`tests` reported"),
    );
    // The run is still an error. The comment does not soften that.
    expect(store.runs.getRun(r.id)?.status).toBe("error");
    expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
  });

  it("records the comment, so a restart does not post a second one", async () => {
    const { store, r, runner, createComment } = timingOut();
    await runner.start(r, "review it");
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(store.runs.announcementOf(r.id)).toBe("turn_timeout");
    // The claim is what stops it, so the second attempt never reaches GitHub.
    expect(store.runs.claimAnnouncement(r.id, "turn_timeout")).toBe(false);
  });

  it("bounds a diff run by the diff ceiling and tells the pull request in diff words", async () => {
    // The diff window is the short one; with the sandbox window alone this
    // run would still be waiting when the test ended.
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const diffRun = store.runs.updateRun(r.id, { mode: "diff", sessionId: "s-diff" }) as RunRecord;
    const createComment = vi.fn(async () => 7);
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => hangsAfterOpening(),
        listEvents: vi.fn(async () => [
          { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:01Z") },
        ]),
        listTurns: vi.fn(async () => [{ id: "t1", state: { status: "running" } }]),
        cancelTurn: vi.fn(async () => {}),
      } as unknown as Harness,
      {
        turnTimeoutMs: 60_000,
        diffTurnTimeoutMs: 5,
        retryDelaysMs: [0],
        pollIntervalMs: 1,
        links: { publicBaseUrl: "" },
      },
      undefined,
      { createComment } as unknown as never,
    );
    await runner.start(diffRun, "read it");
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    const body = String((createComment.mock.calls[0] as unknown[])?.[2]);
    expect(body).toContain("The diff review reached its 0 minute ceiling");
    expect(body).toContain("/cujo review");
    expect(body).not.toContain("checks");
    expect(store.runs.getRun(r.id)?.status).toBe("error");
  });

  it("says nothing when the read back finds a review the stream had not", async () => {
    // Then the author already has the review, and a comment saying the run did
    // not finish would contradict the thing sitting above it.
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const createComment = vi.fn(async () => 7);
    const whole = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      ...checkReported("tests"),
      reviewCall("c1"),
      reviewPosted("c1"),
    ];
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => hangsAfterOpening(),
        listEvents: vi.fn(async () => whole.map((event) => ({ turnId: "t1", event }))),
        listTurns: vi.fn(async () => [{ id: "t1", state: { status: "running" } }]),
        cancelTurn: vi.fn(async () => {}),
      } as unknown as Harness,
      { turnTimeoutMs: 5, retryDelaysMs: [0], pollIntervalMs: 1 },
      undefined,
      { createComment } as unknown as never,
    );
    await runner.start(r, "review it");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(createComment).not.toHaveBeenCalled();
  });
});

describe("Runner.consume", () => {
  it("resubscribes after a dropped stream and finishes the turn", async () => {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    const events: StreamEvent[] = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      ...(checkReported("tests") as StreamEvent[]),
      reviewCall("c1"),
      reviewPosted("c1"),
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
      ...(checkReported("tests") as StreamEvent[]),
      reviewCall("c1"),
      reviewPosted("c1"),
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
        ...checkReported("tests"),
        reviewCall("c1"),
        reviewPosted("c1"),
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

    it("keeps reading when the turn ended but its events would not come back", async () => {
      // The turn is over, so the watch would stop -- but a replay that teaches
      // nothing is not a verdict. Returning here would hand `consume` a
      // `running` projection with its watchdog about to be cleared and no
      // follower, poller or timer left to finish the run.
      const listEvents = vi.fn(async () => {
        throw new Error("session unreadable");
      });
      const { store, r, runner, opening } = lost(
        { listTurns: vi.fn(async () => [{ id: "t1", state: { status: "done" } }]), listEvents },
        150,
      );
      await runner.consume(r.id, opening);
      expect(listEvents.mock.calls.length).toBeGreaterThan(1);
      expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
    });

    it("keeps reading when the replay comes back without the turn's tail", async () => {
      const listEvents = vi.fn(async () => [
        { turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:01Z") },
      ]);
      const { store, r, runner, opening } = lost(
        { listTurns: vi.fn(async () => [{ id: "t1", state: { status: "done" } }]), listEvents },
        150,
      );
      await runner.consume(r.id, opening);
      expect(listEvents.mock.calls.length).toBeGreaterThan(1);
      expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
    });

    it("keeps the watchdog's verdict when it fires part-way through a replay", async () => {
      // The read crosses an await and the watchdog can fire inside it. A
      // wholesale assignment would drop the terminal event the watchdog had
      // just appended, put the fold back to `running`, and strand the run with
      // its timer already spent.
      const listEvents = vi.fn(async () => {
        await new Promise((res) => setTimeout(res, 220));
        return [{ turnId: "t1", event: turnCreated("t1", null, "2026-08-27T10:00:01Z") }];
      });
      const { store, r, runner, opening } = lost(
        { listTurns: vi.fn(async () => [{ id: "t1", state: { status: "done" } }]), listEvents },
        120,
      );
      await runner.consume(r.id, opening);
      // The watchdog's verdict, not the replay's silence -- and specifically
      // not the "could not be followed" backstop, which would mean the
      // synthetic terminal had been lost.
      expect(store.runs.getProjection(r.id)?.error).toContain("turn timeout");
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

describe("Runner.dismiss", () => {
  const review = (id: number, commitId: string, state = "CHANGES_REQUESTED") => ({
    id,
    commitId,
    state,
  });

  function blocked(over: { github?: unknown } = {}) {
    const store = new Store(":memory:");
    const { run: r } = store.runs.createRun(claim());
    store.runs.updateRun(r.id, { turnIds: ["t1"], status: "blocked" });
    store.runs.putProjection(r.id, { ...emptyProjection(), status: "blocked" });
    const listBotReviews = vi.fn(async () => [
      review(11, "h"),
      review(12, "old"),
      review(13, "h", "COMMENTED"),
    ]);
    const dismissReview = vi.fn(async () => {});
    const github = "github" in over ? over.github : { listBotReviews, dismissReview };
    const runner = new Runner(
      store.runs,
      {} as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      undefined,
      github as never,
    );
    const seen: string[] = [];
    runner.changes.on(ANY_RUN, (view: RunView | null) => {
      if (view) seen.push(view.run.status);
    });
    return { store, runner, id: r.id, listBotReviews, dismissReview, seen };
  }

  it("dismisses the bot's REQUEST_CHANGES on that head, moves the row, and emits", async () => {
    const { store, runner, id, dismissReview, seen } = blocked();
    expect(await runner.dismiss(id, "github:octocat")).toEqual({ ok: true });
    // Only the blocking review on this commit; an older head's and a plain
    // comment review are left alone.
    expect(dismissReview).toHaveBeenCalledTimes(1);
    expect(dismissReview).toHaveBeenCalledWith(
      "o/r",
      1,
      11,
      "Dismissed by @octocat with /cujo dismiss.",
    );
    expect(store.runs.getRun(id)).toMatchObject({
      status: "dismissed",
      approver: "github:octocat",
    });
    expect(store.runs.getProjection(id)?.status).toBe("dismissed");
    expect(seen).toEqual(["dismissed"]);
  });

  it("dismisses once and rejects a second decision", async () => {
    const { runner, id, dismissReview } = blocked();
    const [a, b] = await Promise.all([
      runner.dismiss(id, "github:a"),
      runner.dismiss(id, "github:b"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ reason: "already_decided" });
    expect(dismissReview).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when GitHub refuses the write, so the block stands", async () => {
    const { store, runner, id, dismissReview } = blocked();
    dismissReview.mockRejectedValueOnce(new Error("403"));
    const first = await runner.dismiss(id, "github:a");
    expect(first).toMatchObject({ ok: false, reason: "github_failed" });
    expect(store.runs.getRun(id)).toMatchObject({ status: "blocked", approver: null });
    expect((await runner.dismiss(id, "github:a")).ok).toBe(true);
  });

  it("refuses a run that is not blocked, and one that does not exist", async () => {
    const { store, runner, id } = blocked();
    store.runs.updateRun(id, { status: "clean" });
    expect(await runner.dismiss(id, "github:a")).toMatchObject({ reason: "not_blocked" });
    expect(await runner.dismiss("nope", "github:a")).toMatchObject({ reason: "no_such_run" });
  });

  it("moves the row even with no GitHub client, and when no review matches", async () => {
    // The trusted side's record is what the check run, the card and the
    // reaction read; a review somebody dismissed by hand first is not a
    // reason to leave the block on the record.
    const bare = blocked({ github: null });
    expect(await bare.runner.dismiss(bare.id, "github:a")).toEqual({ ok: true });
    expect(bare.store.runs.getRun(bare.id)?.status).toBe("dismissed");
    const none = blocked({ github: { listBotReviews: async () => [], dismissReview: vi.fn() } });
    expect(await none.runner.dismiss(none.id, "github:a")).toEqual({ ok: true });
  });
});

describe("Runner retries a turn that posted nothing", () => {
  const errorDone = (turnId: string): Ev => ({
    type: "turn.done",
    id: `td-${turnId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId: "main",
    state: { status: "error", message: "model down", completedAt: "2026-08-27T00:00:00Z" },
  });

  const cancelledDone = (turnId: string): Ev => ({
    type: "turn.done",
    id: `td-${turnId}`,
    createdAt: "2026-08-27T00:00:00Z",
    threadId: "main",
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
      [
        turnCreated("t2", "t1", "2026-08-27T10:05:00Z"),
        ...checkReported("tests"),
        reviewCall("c1"),
        reviewPosted("c1"),
        turnDone("t2"),
      ],
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
        reviewPosted("c1"),
        turnDone("t1"),
        errorDone("t1b"),
      ],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a post GitHub refused, which the same head would refuse again", async () => {
    // orders-api #44: a 422 on every call. A second sandbox buys the same
    // answer, so the run ends `error` naming the refusal (decision 140).
    const { store, r, runner, startTurn } = runnerOver([
      [
        turnCreated("t1", null, "2026-08-27T10:00:01Z"),
        reviewCall("c1"),
        reviewPosted("c1", true),
        turnDone("t1"),
      ],
    ]);
    await runner.start(r, "review it");
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(store.runs.getRun(r.id)).toMatchObject({ status: "error" });
    expect(store.runs.getProjection(r.id)?.error).toBe(
      "review post failed: post_advisory_review — GitHub 422: Review cannot be requested",
    );
    expect(store.runs.getProjection(r.id)?.review).toBeNull();
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

  it("says no when the harness refuses, and leaves the run protected", async () => {
    // Cancel failed: the status stays `running` so the partial unique index
    // continues protecting the head (decision 104). The caller is told
    // explicitly rather than left to infer it from a resolved call.
    const { store, r, runner } = superseding(async () => {
      throw new Error("harness unreachable");
    });
    store.runs.updateRun(r.id, { turnIds: ["t1"] });
    expect(await runner.supersede(r.id)).toBe(false);
    expect(store.runs.getRun(r.id)?.status).toBe("running");
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

describe("Runner writes a finished detonation through to the cache (decision 145)", () => {
  const EXAMPLE = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../../docs/contracts/report.example.json"),
      "utf8",
    ),
  );
  /** A detonation report with one cacheable entry and one range that is not. */
  const detonationReport = () => {
    const { argv: _argv, exit: _exit, ...sensors } = structuredClone(EXAMPLE.runs[0]);
    const entry = (dependency: string) => ({
      ...sensors,
      dependency,
      source: "pypi",
      install_ok: true,
      window_exclusive: true,
      egress: [{ host: "pypi.org", port: 443, known: true }],
      secret_probe: { decoy_read: false, decoy_in_egress: false },
      derived: {
        egress_to_unknown_host: false,
        wrote_outside_workspace: false,
        wrote_sensitive: false,
        spawned_subprocess: false,
      },
    });
    // A clean envelope: the example's own is adversarial by design.
    return {
      schema_version: 1,
      check: "detonation",
      runs: [entry("humanize==4.9.0"), entry("rich>=13")],
      derived: {
        egress_to_unknown_host: false,
        wrote_outside_workspace: false,
        wrote_sensitive: false,
        spawned_subprocess: false,
      },
      sensors: structuredClone(EXAMPLE.runs[0].sensors),
      truncated: structuredClone(EXAMPLE.truncated),
    };
  };
  const detonationDone = (): Ev[] => {
    const [created, done] = checkReported("detonation");
    const output = (done as { state: { output: { content: string } } }).state.output;
    output.content = `\`\`\`json\n${JSON.stringify(detonationReport())}\n\`\`\``;
    return [created as Ev, done as Ev];
  };

  function build(put: (entry: unknown) => void, store = new Store(":memory:")) {
    const { run: r } = store.runs.createRun(claim());
    const events: Ev[] = [
      turnCreated("t1", null, "2026-08-27T10:00:01Z"),
      ...detonationDone(),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ];
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => streamOf(events),
        listEvents: async () => events.map((event) => ({ turnId: "t1", event })),
        listTurns: async () => [],
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      createLogger({ service: "cujo", sink: () => {} }),
      null,
      { put },
    );
    return { store, r, runner };
  }

  it("writes the cacheable entries once, keyed on the normalised specifier", async () => {
    const written: unknown[] = [];
    const { store, r, runner } = build((entry) => written.push(entry));
    await runner.start(r, "review it");
    expect(store.runs.getProjection(r.id)?.error).toBeNull();
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      source: "pypi",
      specifier: "humanize==4.9.0",
      runId: r.id,
      createdAt: "2026-08-27T00:00:00Z",
    });
  });

  it("writes nothing again when a later process rehydrates the finished run", async () => {
    const written: unknown[] = [];
    const first = build((entry) => written.push(entry));
    await first.runner.start(first.r, "review it");
    // A second runner over the same store sees the check as already finished.
    const again = build((entry) => written.push(entry), first.store);
    const run = first.store.runs.getRun(first.r.id);
    if (!run) throw new Error("run vanished");
    await again.runner.rehydrate(run);
    expect(written).toHaveLength(1);
  });

  it("does not fail the fold when the cache write throws", async () => {
    const { store, r, runner } = build(() => {
      throw new Error("disk full");
    });
    await runner.start(r, "review it");
    expect(store.runs.getRun(r.id)?.status).toBe("clean");
  });
});
