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
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import type { Harness, StreamEvent } from "../../src/clients/trueforge";
import { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";

type Ev = TrueForgeApi.SessionEvent;

const at = "2026-08-27T10:00:00Z";

const turnCreated = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: null,
  turnId,
  previousTurnId: null,
  input: [],
});

const turnDone = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.done",
  id: `td-${turnId}`,
  createdAt,
  threadId: null,
  turnId,
  state: { status: "done" },
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
    } as unknown as TrueForgeApi.ToolCall,
  ],
});

const threadCreated = (threadId: string, title: string, createdAt: string = at): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: {} as TrueForgeApi.AgentInfo,
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
