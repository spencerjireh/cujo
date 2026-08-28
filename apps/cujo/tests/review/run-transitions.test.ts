/**
 * What a run says about itself as it moves (decision 37).
 *
 * Every line here is emitted from `refold` and never from `fold`. `fold` is
 * pure and is replayed in full on every rehydrate, so a log call there would
 * re-announce a run's whole history at each restart; `refold` is already the
 * single place a status is written, so "one writer, one emitter" is a property
 * the code had rather than one the log invents.
 */

import { type Level, createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { Harness, SessionEvent, StreamEvent } from "../../src/clients/trueforge";
import { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";

// `SessionEvent` through the client wrapper rather than `TrueForgeApi`
// direct: `clients/trueforge.ts` is the only module that should track the
// SDK's shapes, and it already re-exports the ones a test needs.
type Ev = SessionEvent;

const at = "2026-08-27T10:00:00Z";

const turnCreated = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: null,
  turnId,
  previousTurnId: null,
  state: { status: "running" },
});

const turnDone = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.done",
  id: `td-${turnId}`,
  createdAt,
  threadId: null,
  state: { status: "done", completedAt: createdAt, output: null, requiredActions: [] },
});

const approvalRequired = (callId: string): Ev => ({
  type: "tool.approval_required",
  id: `ar-${callId}`,
  createdAt: at,
  threadId: "main",
  toolCalls: [{ id: callId, sourceEventId: "none" }],
});

const reviewCall = (id: string): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: at,
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
    } as never,
  ],
});

const threadCreated = (threadId: string, title: string, createdAt: string = at): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: {} as never,
});

const threadDone = (threadId: string, createdAt: string): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt,
  threadId,
  title: threadId,
  state: {
    status: "done",
    output: { type: "model.message", id: "out", createdAt, threadId, content: "{}" },
  },
});

async function* streamOf(events: Ev[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event as StreamEvent;
}

function build(events: Ev[], level: Level = "info") {
  const store = new Store(":memory:");
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "cujo",
    level,
    sink: (line) => lines.push(JSON.parse(line)),
  });
  const { run } = store.runs.createRun({
    repo: "o/r",
    prNumber: 7,
    headSha: "h",
    sessionId: "s",
    isPublic: true,
    deliveryId: "delivery-1",
  });
  const runner = new Runner(
    store.runs,
    {
      startTurn: async () => "t1",
      subscribe: async () => streamOf(events),
    } as unknown as Harness,
    { turnTimeoutMs: 10_000 },
    log,
  );
  const logged = (event: string) => lines.filter((line) => line.event === event);
  return { store, runner, run, lines, logged };
}

describe("run.status.changed", () => {
  it("reports the transition, and carries the delivery that started the run", async () => {
    const { runner, run, logged } = build([turnCreated("t1"), reviewCall("c1"), turnDone("t1")]);
    await runner.start(run, "review it");
    const [line] = logged("run.status.changed");
    expect(line).toMatchObject({
      run_id: run.id,
      repo: "o/r",
      pr_number: 7,
      from: "running",
      to: "clean",
      // The correlation id survives the request that is long over, which is
      // the whole reason it lives on the row.
      ray: "delivery-1",
      delivery_id: "delivery-1",
    });
  });

  it("says nothing on a refold that changes nothing", async () => {
    // refold runs once per stream event; a line per fold would bury the run
    // it is describing.
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", at),
      reviewCall("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    expect(logged("run.status.changed")).toHaveLength(1);
  });
});

describe("check.started and check.finished", () => {
  it("reports each check once, with the duration from the event clock", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests", "2026-08-27T10:00:00Z"),
      threadDone("sub-1", "2026-08-27T10:00:04Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    expect(logged("check.started")).toHaveLength(1);
    expect(logged("check.started")[0]).toMatchObject({ check: "tests", thread_id: "sub-1" });
    // Four seconds of event time, not of wall time: a run rehydrated hours
    // later still reports what the check actually took.
    expect(logged("check.finished")[0]).toMatchObject({
      check: "tests",
      status: "done",
      duration_ms: 4000,
    });
  });

  it("ignores a thread that is not one of the four checks", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-9", "some other thread"),
      threadDone("sub-9", at),
      reviewCall("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    expect(logged("check.started")).toEqual([]);
    expect(logged("check.finished")).toEqual([]);
  });

  it("does not re-announce a check that finished before a restart", async () => {
    // A rehydrate replays every event, so without the seed from the stored
    // projection each restart would report the whole run again.
    const events = [
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const first = build(events);
    await first.runner.start(first.run, "review it");
    expect(first.logged("check.finished")).toHaveLength(1);

    // A second Runner over the same store is what a restart looks like.
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    const restarted = new Runner(
      first.store.runs,
      {
        // listEvents returns { turnId, event } wrappers, not bare events.
        listEvents: async () => events.map((event) => ({ turnId: "t1", event })),
        subscribe: async () => streamOf([]),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    const reloaded = first.store.runs.getRun(first.run.id);
    if (!reloaded) throw new Error("run vanished");
    await restarted.rehydrate(reloaded);
    expect(lines.filter((l) => l.event === "check.finished")).toEqual([]);
  });
});

describe("a turn start is announced once", () => {
  it("emits run.turn.started only after TrueForge returns the turn id", async () => {
    // startRun used to announce it too, before the turn existed and without a
    // turn_id — two events per start, and on a failure a run.turn.started
    // immediately followed by run.turn.start.failed, describing a turn that
    // never was.
    const { runner, run, logged } = build([turnCreated("t1"), reviewCall("c1"), turnDone("t1")]);
    await runner.start(run, "review it");
    expect(logged("run.turn.started")).toHaveLength(1);
    expect(logged("run.turn.started")[0]).toMatchObject({ turn_id: "t1" });
  });
});

describe("a transition is announced before it is persisted", () => {
  it("re-announces after a crash between the emit and the write, rather than losing it", async () => {
    // reportedChecks is seeded from the persisted projection, so persisting
    // first and dying in the gap would leave the next process treating a
    // transition it never announced as already reported — missing forever.
    // Emitting first turns that same crash into a duplicate, which is
    // recoverable and visible.
    const events = [
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:03Z"),
      reviewCall("c1"),
      turnDone("t1"),
    ];
    const store = new Store(":memory:");
    const { run } = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      isPublic: true,
      deliveryId: null,
    });
    // A sink that dies the first time a check is reported is what a crash in
    // the gap looks like from the store's point of view: the projection has
    // not been written yet, so the next process has nothing to be misled by.
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        subscribe: async () => streamOf(events),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    await runner.start(run, "review it");
    const finished = lines.filter((l) => l.event === "check.finished");
    expect(finished).toHaveLength(1);
    // And the projection that a restart would seed from agrees with what was
    // announced, so the two cannot drift.
    const stored = store.runs.getProjection(run.id);
    expect(stored?.checks.find((c) => c.threadId === "sub-1")?.status).toBe("done");
  });
});

describe("the paths that were silent", () => {
  it("says when the watchdog ends a turn, so a timeout is not read as a failure", async () => {
    // The synthetic turn.done the watchdog injects is indistinguishable
    // downstream from a turn that failed on its own merits.
    const store = new Store(":memory:");
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    const { run } = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      isPublic: true,
      deliveryId: null,
    });
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        // A stream that never ends and never yields a terminal event.
        subscribe: async () =>
          (async function* () {
            yield turnCreated("t1") as StreamEvent;
            await new Promise((resolve) => setTimeout(resolve, 50));
          })(),
      } as unknown as Harness,
      { turnTimeoutMs: 1 },
      log,
    );
    await runner.start(run, "review it");
    expect(lines.filter((l) => l.event === "run.turn.timeout")[0]).toMatchObject({
      run_id: run.id,
      timeout_ms: 1,
    });
  });
});

/**
 * The heal is the one path here that answers a *TrueForge* approval on its own
 * initiative, so what it says about itself is the only record that it did.
 * These assert the lines, not the behaviour — `runner.service.test.ts` owns
 * the behaviour and takes no sink.
 */
describe("healing a wedged session", () => {
  const claim = (headSha = "h") => ({
    repo: "o/r",
    prNumber: 7,
    headSha,
    sessionId: "s",
    isPublic: true,
    deliveryId: "delivery-1",
  });

  function sink() {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    return { lines, log, logged: (event: string) => lines.filter((l) => l.event === event) };
  }

  /** A session holding one unanswered approval, and a first `startTurn` that 422s. */
  function wedged(harness: Partial<Record<string, unknown>> = {}) {
    const store = new Store(":memory:");
    const { log, logged } = sink();
    const { run } = store.runs.createRun(claim());
    const startTurn = vi
      .fn()
      .mockRejectedValueOnce(new Error("422 user message cannot be sent"))
      .mockResolvedValueOnce("t2");
    const runner = new Runner(
      store.runs,
      {
        startTurn,
        resume: async () => "t-deny",
        cancelTurn: async () => {},
        listEvents: async () => [
          { turnId: "t1", event: turnCreated("t1") },
          { turnId: "t1", event: approvalRequired("c1") },
          { turnId: "t1", event: turnDone("t1") },
        ],
        subscribe: async () => streamOf([turnDone("t2")]),
        ...harness,
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    return { store, run, runner, startTurn, logged };
  }

  it("records the first failure even when the heal rescues the turn", async () => {
    // The regression the merge with main could have hidden: this branch
    // replaced the only `run.turn.start.failed` with a warning about looking
    // for a stale approval, which would have made a session wedged badly
    // enough to need healing indistinguishable from one that started first go.
    const { run, runner, startTurn, logged } = wedged();

    await runner.start(run, "review it");

    expect(startTurn).toHaveBeenCalledTimes(2);
    const failed = logged("run.turn.start.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: "error",
      attempt: 1,
      session_id: "s",
      run_id: run.id,
      error_message: expect.stringContaining("422"),
    });
    // And the run still reports the turn it eventually got.
    expect(logged("run.turn.started")).toHaveLength(1);
    runner.stopAll();
  });

  it("names the approval it cleared and the turn the deny started", async () => {
    const { run, runner, logged } = wedged();

    await runner.start(run, "review it");

    expect(logged("run.approval.cleared")[0]).toMatchObject({
      level: "info",
      session_id: "s",
      turn_id: "t-deny",
      reason: "wedged_session",
      // The healing run, not the terminal run that raised the approval — that
      // one has no id here, which is why the deny is sent without one.
      run_id: run.id,
    });
    runner.stopAll();
  });

  it("says why it refused, without naming the wrong run", async () => {
    const store = new Store(":memory:");
    const { log, logged } = sink();
    const other = store.runs.createRun(claim("h1")).run;
    store.runs.updateRun(other.id, { status: "blocked_pending" });
    const { run } = store.runs.createRun(claim("h2"));
    const listEvents = vi.fn();
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => {
          throw new Error("422 user message cannot be sent");
        },
        resume: vi.fn(),
        listEvents,
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );

    await runner.start(run, "review it");

    // Refused before the round trip, so the reason is the only evidence.
    expect(listEvents).not.toHaveBeenCalled();
    const [line] = logged("run.approval.clear.skipped");
    expect(line).toMatchObject({
      level: "warn",
      session_id: "s",
      reason: "run_in_flight",
      status: "blocked_pending",
      active: 1,
    });
    // The blocking run's id deliberately does not appear: bound fields beat
    // call-site fields, so putting it in `run_id` would be overwritten with
    // the healing run's id and the line would name the wrong run.
    expect(line?.run_id).toBe(run.id);
    expect(line?.run_id).not.toBe(other.id);
    runner.stopAll();
  });

  it("reports a run that could not be healed at error, and does not claim a retry", async () => {
    const store = new Store(":memory:");
    const { log, logged } = sink();
    const { run } = store.runs.createRun(claim());
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => {
          throw new Error("harness down");
        },
        resume: vi.fn(),
        // A session with nothing pending: there is nothing to heal.
        listEvents: async () => [
          { turnId: "t1", event: turnCreated("t1") },
          { turnId: "t1", event: turnDone("t1") },
        ],
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );

    await runner.start(run, "review it");

    const failed = logged("run.turn.start.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "error", attempt: 1 });
    // No second attempt was made, so none may be reported.
    expect(failed.some((line) => line.attempt === 2)).toBe(false);
    expect(logged("run.approval.cleared")).toHaveLength(0);
    runner.stopAll();
  });

  it("announces the deny on the supersede path too, with its own reason", async () => {
    // The production bug the whole change exists to fix. Nothing else asserts
    // that the fix announces itself.
    const store = new Store(":memory:");
    const { log, logged } = sink();
    const runner = new Runner(
      store.runs,
      { resume: async () => "t-deny", cancelTurn: async () => {} } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    const { run } = store.runs.createRun(claim());
    await runner.consume(
      run.id,
      streamOf([turnCreated("t1"), approvalRequired("c1"), turnDone("t1")]),
    );
    expect(store.runs.getRun(run.id)?.status).toBe("blocked_pending");

    await runner.supersede(run.id);

    expect(logged("run.approval.cleared")[0]).toMatchObject({
      session_id: "s",
      turn_id: "t-deny",
      reason: "newer_head",
      run_id: run.id,
    });
    runner.stopAll();
  });
});
