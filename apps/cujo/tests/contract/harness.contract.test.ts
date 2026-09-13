/**
 * Harness contract tests: the behaviors apps/cujo relies on, run against a
 * real `apps/harness` and a real github-mcp (`make test-int`). Every
 * assumption the unit tests fake is checked here: a turn id is known at
 * creation, a subscription replays the turn from its first event and then
 * streams live, a later turn chains to the previous one, cancel ends the
 * running turn, creating a turn while one runs ends the old one, a sub-agent's
 * report is durable before its parent finishes, the gate holds and the answer
 * reaches the model, and the events a review tool call produces fold into
 * the statuses Contract 6 promises. Skipped unless HARNESS_BASE_URL is set.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Harness,
  type StreamEvent,
  type TurnCreatedEvent,
  type TurnDoneEvent,
} from "../../src/clients/harness";
import type { Config } from "../../src/config";
import { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";
import { type StubModel, startStubModel } from "./stub-model";

const BASE_URL = process.env.HARNESS_BASE_URL;
/** How the harness container reaches this process. */
const STUB_HOST = process.env.CUJO_STUB_MODEL_HOST ?? "host.docker.internal";
/** How the harness container reaches github-mcp (the compose service name). */
const GITHUB_MCP_URL = process.env.CUJO_GITHUB_MCP_URL ?? "http://github-mcp:8081/mcp";
/** Registered so bootstrap is complete; never called, since no spec here names it. */
const SANDBOX_MCP_URL = process.env.CUJO_SANDBOX_MCP_URL ?? "http://sandbox-mcp:8082/mcp";
const PROVIDER = "cujo-contract-stub";
const MODEL = `${PROVIDER}/stub`;
const REVIEW_ARGS = JSON.stringify({
  repo: "o/r",
  pr_number: 1,
  head_sha: "abcdef1",
  body: "Tests: fine.",
  comments: [],
});

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (event.type === "turn.done") break;
  }
  return events;
}

const stored = (events: StreamEvent[]) => events.filter((e) => e.type !== "model.message.delta");
const turnCreated = (events: StreamEvent[]) =>
  events.find((e): e is TurnCreatedEvent => e.type === "turn.created");
const turnDone = (events: StreamEvent[]) =>
  events.find((e): e is TurnDoneEvent => e.type === "turn.done");
const outputText = (events: StreamEvent[]) => {
  const done = turnDone(events);
  return done?.state.status === "done" ? (done.state.output?.content ?? "") : "";
};

const spec = () => ({
  model: { name: MODEL, params: { reasoningEffort: "low" as const } },
  instructions: "Do what the user message says.",
  mcpServers: [{ name: "github-mcp", requireApprovalForTools: [] }],
  config: { iterationLimit: 20, compaction: { enabled: false } },
});

describe.skipIf(!BASE_URL)("harness contract", () => {
  let stub: StubModel;
  let harness: Harness;
  let sessionId: string;
  let firstTurn = "";
  let runner: Runner | undefined;

  beforeAll(async () => {
    stub = await startStubModel();
    const config = {
      harnessBaseUrl: BASE_URL,
      githubMcpUrl: GITHUB_MCP_URL,
      sandboxMcpUrl: SANDBOX_MCP_URL,
      bootstrap: {
        modelProvider: {
          name: PROVIDER,
          baseUrl: `http://${STUB_HOST}:${stub.port}/v1`,
          apiKey: "stub",
          models: [{ name: "stub", modelId: "stub-1" }],
          contextWindow: 100_000,
          maxTokens: 4_000,
          // The spec below asks for an effort anyway: the harness clamps it to
          // nothing for a model that declares none (decision 127), and that
          // clamp, not a refusal, is the contract.
          reasoning: false,
        },
      },
    } as unknown as Config;
    harness = new Harness(config);
  });

  afterAll(async () => {
    await stub?.close();
  });

  it("bootstrap registers both MCP servers and the model provider, twice without harm", async () => {
    // The array is pinned deliberately: it is the one place the *order* and the
    // *completeness* of bootstrap are asserted against a real server, and
    // `bootstrapUntilReady` re-applies the whole thing on a retry.
    const applied = await harness.bootstrap();
    expect(applied).toEqual([
      "mcp-server github-mcp",
      "mcp-server sandbox-mcp",
      `model-provider ${PROVIDER}`,
    ]);
    expect(harness.ready).toBe(true);
    await expect(harness.bootstrap()).resolves.toEqual(applied);
  });

  it("creates a session from an inline agent spec that gates nothing", async () => {
    sessionId = await harness.createSession(spec());
    expect(sessionId).toMatch(/\S+/);
    // An unknown model is refused at creation, not at the first turn.
    await expect(
      harness.createSession({ ...spec(), model: { name: `${PROVIDER}/nope` } }),
    ).rejects.toThrow(/Unknown model/);
  });

  it("returns the turn id at creation and replays the turn from turn.created on subscribe", async () => {
    firstTurn = await harness.startTurn(sessionId, "first");
    expect(firstTurn).toMatch(/\S+/);
    const events = await collect(await harness.subscribe(sessionId, firstTurn));
    const created = turnCreated(events);
    expect(created?.turnId).toBe(firstTurn);
    expect(created?.previousTurnId).toBeNull();
    expect(turnDone(events)?.state.status).toBe("done");
    expect(outputText(events)).toBe("echo: first");
    // The stream carries the text as it is produced, and the stored message
    // with it: no stub, no re-read needed to know what the model said.
    expect(events.filter((e) => e.type === "model.message.delta").length).toBeGreaterThan(0);
    const message = events.find((e) => e.type === "model.message");
    expect(message && "content" in message ? message.content : null).toBe("echo: first");
  });

  it("replays a finished turn in full on a later subscribe, then closes", async () => {
    const events = stored(await collect(await harness.subscribe(sessionId, firstTurn)));
    expect(turnCreated(events)?.turnId).toBe(firstTurn);
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("chains the next turn to the previous one, and lists events oldest first", async () => {
    const second = await harness.startTurn(sessionId, "second");
    const events = await collect(await harness.subscribe(sessionId, second));
    expect(turnCreated(events)?.previousTurnId).toBe(firstTurn);

    const items = await harness.listEvents(sessionId);
    const turnIds = [...new Set(items.map((i) => i.turnId))];
    expect(turnIds).toEqual([firstTurn, second]);
    expect(items[0]?.event.type).toBe("turn.created");

    const turns = await harness.listTurns(sessionId);
    expect(turns.map((t) => t.id)).toEqual([firstTurn, second]);
    // The model saw the whole conversation: the transcript is the session's.
    const last = stub.requests.at(-1)?.messages ?? [];
    expect(last.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("cancel ends the running turn as cancelled", async () => {
    const slow = await harness.startTurn(sessionId, "SLOW one");
    const streamPromise = harness.subscribe(sessionId, slow).then(collect);
    await new Promise((r) => setTimeout(r, 1500));
    await harness.cancelTurn(sessionId);
    const done = turnDone(await streamPromise);
    expect(done?.state.status).toBe("cancelled");
    if (done?.state.status === "cancelled") expect(done.state.reason).toBe("client-cancelled");
  });

  it("creating a turn while one runs ends the old one, and its stream closes", async () => {
    const slow = await harness.startTurn(sessionId, "SLOW two");
    const slowEvents = harness.subscribe(sessionId, slow).then(collect);
    await new Promise((r) => setTimeout(r, 1500));
    const next = await harness.startTurn(sessionId, "third");
    const nextEvents = await collect(await harness.subscribe(sessionId, next));
    expect(turnDone(nextEvents)?.state.status).toBe("done");

    const old = (await harness.listTurns(sessionId)).find((t) => t.id === slow);
    expect(old?.state.status).toBe("cancelled");
    if (old?.state.status === "cancelled") {
      expect(old.state.reason).toBe("cancelled-for-next-turn");
    }
    // The subscriber is told, and the stream ends (unlike TrueForge, which left
    // it open; the runner's explicit cancel before a newer head stays anyway).
    const done = turnDone(await slowEvents);
    expect(done?.state.status).toBe("cancelled");
  });

  const reviewMessage = (tool: string) => `CALL ${tool} ${REVIEW_ARGS}`;

  // The rest drives the real Runner, so the stream, the persisted re-read,
  // the fold, the store, the approve route, and the poll are all exercised.
  const store = new Store(":memory:");
  const runFor = (headSha: string) =>
    store.runs.createRun({ repo: "o/r", prNumber: 1, headSha, sessionId, isPublic: true }).run;
  const settled = (id: string, statuses: string[]) =>
    vi.waitFor(() => expect(statuses).toContain(store.runs.getRun(id)?.status), {
      timeout: 30_000,
      interval: 250,
    });

  it("the model sees the MCP tools by name, plus create_sub_agent", () => {
    const names = stub.requests.at(-1)?.tools?.map((t) => t.function.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["post_advisory_review", "post_blocking_review", "create_sub_agent"]),
    );
    expect(names.some((n) => n === "call_tool" || n === "list_tools")).toBe(false);
    runner = new Runner(store.runs, harness, { turnTimeoutMs: 60_000 });
  });
  const active = (): Runner => {
    if (!runner) throw new Error("runner not built");
    return runner;
  };

  it("an advisory review folds to unproven, even when github-mcp's GitHub call fails", async () => {
    const run = runFor("h-adv");
    await active().start(run, reviewMessage("post_advisory_review"));
    // `unproven` and not `clean`: this turn posts a review without any check
    // having reported, which is the exact shape decision 107 stops calling
    // clean. The review still lands, which is what this test is about.
    expect(store.runs.getRun(run.id)?.status).toBe("unproven");
    const projection = store.runs.getProjection(run.id);
    expect(projection?.review).toMatchObject({
      tool: "post_advisory_review",
      body: "Tests: fine.",
    });
    expect(projection?.summary).toBe("posted");
  });

  it("a blocking review folds to blocked with nobody asked (decision 138)", async () => {
    const run = runFor("h-blk");
    await active().start(run, reviewMessage("post_blocking_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("blocked");
    expect(store.runs.getProjection(run.id)?.review?.tool).toBe("post_blocking_review");
    expect(store.runs.getRun(run.id)?.turnIds).toHaveLength(1);
    // A newer head supersedes it in the store alone: nothing is live to cancel.
    expect(await active().supersede(run.id)).toBe(true);
    expect(store.runs.getRun(run.id)?.status).toBe("superseded");
  });

  it("a sub-agent's name is the thread title, its report is durable before the parent ends, and it trips a hard rule", async () => {
    const run = runFor("h-sub");
    // A whole envelope, not just the field the rule reads: the fold validates
    // the report and adds a `report_invalid` warn beside the rules when it does
    // not hold, so a stub here would assert against a second finding that is
    // about this fixture rather than about the sub-agent.
    const report = {
      check: "tests",
      base_pass_head_fail: ["t_x"],
      runs: [],
      derived: {
        egress_to_unknown_host: false,
        wrote_outside_workspace: false,
        wrote_sensitive: false,
        spawned_subprocess: false,
      },
    };
    // The parent spawns `tests`; the sub-agent's whole input is a SAY, so it
    // ends with the fenced report; the parent's reply to the tool result is
    // plain text, so the turn ends with no review.
    const input = `SAY \`\`\`json ${JSON.stringify(report)} \`\`\``;
    const message = `CALL create_sub_agent ${JSON.stringify({ name: "tests", input })}`;
    await active().start(run, message);
    const projection = store.runs.getProjection(run.id);
    const check = projection?.checks.find((c) => c.title === "tests");
    expect(check).toMatchObject({ isCheck: true, status: "done" });
    expect(check?.report).toMatchObject({ base_pass_head_fail: ["t_x"] });
    expect(projection?.hardRuleHits).toHaveLength(1);
    expect(store.runs.getRun(run.id)?.status).toBe("error");
    expect(projection?.error).toBe("turn ended without a review");
    // Durable as it landed: the thread finished before the parent's turn did.
    const turnId = store.runs.getRun(run.id)?.turnIds[0];
    const types = (await harness.listEvents(sessionId))
      .filter((i) => i.turnId === turnId)
      .map((i) => i.event.type);
    expect(types.indexOf("thread.done")).toBeLessThan(types.lastIndexOf("turn.done"));
  });

  it("listEvents returns every event past a hundred", async () => {
    const before = (await harness.listEvents(sessionId)).length;
    // Three events per plain turn; enough to cross what a page used to hold.
    const needed = Math.ceil(Math.max(0, 110 - before) / 3);
    for (let i = 0; i < needed; i += 1) {
      const turn = await harness.startTurn(sessionId, `m${i}`);
      await collect(await harness.subscribe(sessionId, turn));
    }
    expect((await harness.listEvents(sessionId)).length).toBeGreaterThan(100);
  }, 120_000);

  /**
   * Decision 69's wedge, inverted. A running sub-agent used to hold the
   * session so that no later message was accepted; now a new turn ends the
   * parent and, through it, the child.
   */
  it("a new turn while a sub-agent runs supersedes it, and the child stops", async () => {
    const own = await harness.createSession(spec());
    const spawn = `CALL create_sub_agent ${JSON.stringify({ name: "tests", input: "SLOW" })}`;
    const parent = await harness.startTurn(own, spawn);
    const parentEvents = harness.subscribe(own, parent).then(collect);
    await new Promise((r) => setTimeout(r, 3_000));
    const statusOf = async (id: string) =>
      (await harness.listTurns(own)).find((t) => t.id === id)?.state.status;
    expect(await statusOf(parent)).toBe("running");

    const second = await harness.startTurn(own, "second");
    const events = await collect(await harness.subscribe(own, second));
    expect(turnDone(events)?.state.status).toBe("done");
    expect(await statusOf(parent)).toBe("cancelled");
    const first = stored(await parentEvents);
    const thread = first.find((e) => e.type === "thread.done");
    expect(thread && "state" in thread ? thread.state.status : null).toBe("error");
  }, 60_000);
});
