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
import type { Harness, SessionEvent, StreamEvent } from "../../src/clients/harness";
import { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";

// `SessionEvent` through the client wrapper rather than the contract package
// direct: `clients/harness.ts` is the only module that should track the
// contract's shapes, and it already re-exports the ones a test needs.
type Ev = SessionEvent;

const at = "2026-08-27T10:00:00Z";

const turnCreated = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: "main",
  turnId,
  previousTurnId: null,
  input: [],
});

const turnDone = (turnId: string, createdAt: string = at): Ev => ({
  type: "turn.done",
  id: `td-${turnId}`,
  createdAt,
  threadId: "main",
  state: { status: "done", completedAt: createdAt, output: null, requiredActions: [] },
});

const reviewCall = (id: string): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: at,
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
  createdAt: at,
  threadId: "main",
  toolCallId: id,
  toolName: "post_advisory_review",
  content: isError ? "GitHub 422: Review cannot be requested" : "{}",
  isError,
});

const threadCreated = (threadId: string, title: string, createdAt: string = at): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: { type: "dynamic", name: title, input: "" },
});

const threadDone = (threadId: string, createdAt: string, report?: string): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt,
  threadId,
  title: threadId,
  parent: { threadId: "main", toolCallId: "spawn" },
  state: {
    status: "done",
    output: {
      type: "model.message",
      id: "out",
      createdAt,
      threadId,
      content: report ?? "{}",
    },
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
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", at),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
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
      reviewPosted("c1"),
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
      reviewPosted("c1"),
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
      reviewPosted("c1"),
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
      reviewPosted("c1"),
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
  it("emits run.turn.started only after the harness returns the turn id", async () => {
    // startRun used to announce it too, before the turn existed and without a
    // turn_id — two events per start, and on a failure a run.turn.started
    // immediately followed by run.turn.start.failed, describing a turn that
    // never was.
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", at),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
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
      reviewPosted("c1"),
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
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        cancelTurn,
        listTurns: async () => [{ id: "t1", state: { status: "running" } }],
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
    // The watchdog is the one place Cujo ends a turn on its own authority, so
    // it is the one place that has to stop it. A turn left running holds the
    // session and every later head fails to start on it.
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledWith("s"));
  });

  it("does not let an old watchdog cancel the turn that replaced it", async () => {
    // Runs share a pull request's session and `cancelTurn` takes a session, so
    // a timer still armed after a supersede would otherwise stop the newer
    // head's turn instead of the one that timed out.
    const store = new Store(":memory:");
    const { run } = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      isPublic: true,
      deliveryId: null,
    });
    const cancelTurn = vi.fn(async () => {});
    const runner = new Runner(
      store.runs,
      {
        startTurn: async () => "t1",
        cancelTurn,
        // By the time the watchdog fires, `t1` is over and something else owns
        // the session.
        listTurns: async () => [
          { id: "t1", state: { status: "cancelled", reason: "cancelled-for-next-turn" } },
          { id: "t2", state: { status: "running" } },
        ],
        subscribe: async () =>
          (async function* () {
            yield turnCreated("t1") as StreamEvent;
            await new Promise((resolve) => setTimeout(resolve, 50));
          })(),
      } as unknown as Harness,
      { turnTimeoutMs: 1 },
      createLogger({ service: "cujo", sink: () => {} }),
    );
    await runner.start(run, "review it");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("says when a cancel it chose to make could not be delivered", async () => {
    const store = new Store(":memory:");
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
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
        listTurns: async () => [{ id: "t1", state: { status: "running" } }],
        cancelTurn: async () => {
          throw new Error("harness down");
        },
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
    await vi.waitFor(() =>
      expect(lines.filter((l) => l.event === "run.cancel.failed")[0]).toMatchObject({
        session_id: "s",
        reason: "turn_timeout",
      }),
    );
  });
});

describe("check.hard_rule.tripped", () => {
  const failingReport = JSON.stringify({
    base_pass_head_fail: ["test_total_rounds_up"],
    sensors: { proxy: { armed: true }, decoy: { armed: true } },
  });

  it("emits one line per hard-rule finding, with rule, check, and claim", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z", `\`\`\`json\n${failingReport}\n\`\`\``),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const tripped = logged("check.hard_rule.tripped");
    const testsFailed = tripped.find((l) => l.rule === "tests_failed");
    expect(testsFailed).toMatchObject({
      level: "warn",
      rule: "tests_failed",
      check: "tests",
      severity: "critical",
      claim: "correctness",
    });
  });

  it("labels a malice rule as such", async () => {
    const maliceReport = JSON.stringify({
      secret_probe: { decoy_read: true },
      sensors: { proxy: { armed: true }, decoy: { armed: true } },
    });
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "probes"),
      threadDone("sub-1", "2026-08-27T10:00:02Z", `\`\`\`json\n${maliceReport}\n\`\`\``),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const tripped = logged("check.hard_rule.tripped");
    const decoyHit = tripped.find((l) => l.rule === "decoy_read");
    expect(decoyHit).toMatchObject({
      claim: "malice",
      severity: "critical",
      check: "probes",
    });
  });

  it("labels sensor_unarmed as an operational claim", async () => {
    const unarmedReport = JSON.stringify({
      sensors: { proxy: { armed: false, detail: "never started" }, decoy: { armed: true } },
    });
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z", `\`\`\`json\n${unarmedReport}\n\`\`\``),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const tripped = logged("check.hard_rule.tripped");
    const unarmed = tripped.find((l) => l.rule === "sensor_unarmed");
    expect(unarmed).toMatchObject({ claim: "operational", severity: "warn" });
  });

  it("does not re-announce the same hard rule on a later refold", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z", `\`\`\`json\n${failingReport}\n\`\`\``),
      threadCreated("sub-2", "probes"),
      threadDone("sub-2", "2026-08-27T10:00:03Z"),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const tripped = logged("check.hard_rule.tripped");
    const keys = tripped.map((l) => `${l.rule}:${l.check}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it("is not re-emitted on rehydrate (seeded from stored projection)", async () => {
    const events = [
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z", `\`\`\`json\n${failingReport}\n\`\`\``),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ];
    const first = build(events);
    await first.runner.start(first.run, "review it");
    expect(first.logged("check.hard_rule.tripped").length).toBeGreaterThanOrEqual(1);

    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    const restarted = new Runner(
      first.store.runs,
      {
        listEvents: async () => events.map((event) => ({ turnId: "t1", event })),
        subscribe: async () => streamOf([]),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    const reloaded = first.store.runs.getRun(first.run.id);
    if (!reloaded) throw new Error("run vanished");
    await restarted.rehydrate(reloaded);
    expect(lines.filter((l) => l.event === "check.hard_rule.tripped")).toEqual([]);
  });
});

describe("run.setup.completed", () => {
  it("fires once on the first check.started, with the session id", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadCreated("sub-2", "probes"),
      threadDone("sub-1", "2026-08-27T10:00:02Z"),
      threadDone("sub-2", "2026-08-27T10:00:03Z"),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const events = logged("run.setup.completed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ session_id: "s" });
  });

  it("is not re-emitted on rehydrate", async () => {
    const events = [
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", "2026-08-27T10:00:02Z"),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ];
    const first = build(events);
    await first.runner.start(first.run, "review it");
    expect(first.logged("run.setup.completed")).toHaveLength(1);

    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      service: "cujo",
      sink: (line) => lines.push(JSON.parse(line)),
    });
    const restarted = new Runner(
      first.store.runs,
      {
        listEvents: async () => events.map((event) => ({ turnId: "t1", event })),
        subscribe: async () => streamOf([]),
      } as unknown as Harness,
      { turnTimeoutMs: 10_000 },
      log,
    );
    const reloaded = first.store.runs.getRun(first.run.id);
    if (!reloaded) throw new Error("run vanished");
    await restarted.rehydrate(reloaded);
    expect(lines.filter((l) => l.event === "run.setup.completed")).toEqual([]);
  });
});

describe("run.status.changed carries error_message", () => {
  it("includes the error string when a run ends in error", async () => {
    const { runner, run, logged } = build([turnCreated("t1"), turnDone("t1")]);
    await runner.start(run, "review it");
    const changed = logged("run.status.changed");
    const errorLine = changed.find((l) => l.to === "error");
    expect(errorLine).toBeDefined();
    expect(errorLine?.error_message).toMatch(/without a review/i);
  });

  it("omits error_message when the run ends cleanly", async () => {
    const { runner, run, logged } = build([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadDone("sub-1", at),
      reviewCall("c1"),
      reviewPosted("c1"),
      turnDone("t1"),
    ]);
    await runner.start(run, "review it");
    const changed = logged("run.status.changed");
    const cleanLine = changed.find((l) => l.to === "clean");
    expect(cleanLine).toBeDefined();
    expect(cleanLine).not.toHaveProperty("error_message");
  });
});
