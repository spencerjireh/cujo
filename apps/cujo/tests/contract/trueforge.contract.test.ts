/**
 * Harness contract tests: the TrueForge behaviors apps/cujo relies on, run
 * against a real server and a real github-mcp (`make test-int`). Every
 * assumption the unit tests fake is checked here: a turn id is known at
 * creation, a subscription replays the turn from its first event, a later
 * turn chains to the previous one, cancel ends the running turn, creating a
 * turn while one runs cancels the old one, and the events a review tool call
 * produces fold into the statuses Contract 6 promises. Skipped unless
 * TRUEFORGE_BASE_URL is set.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Harness,
  type StreamEvent,
  type ToolApprovalRequiredEvent,
  type TurnCreatedEvent,
  type TurnDoneEvent,
} from "../../src/clients/trueforge";
import type { Config } from "../../src/config";
import { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";
import { type StubModel, startStubModel } from "./stub-model";

const BASE_URL = process.env.TRUEFORGE_BASE_URL;
/** How the server container reaches this process. */
const STUB_HOST = process.env.CUJO_STUB_MODEL_HOST ?? "host.docker.internal";
/** How the server container reaches github-mcp (the compose service name). */
const GITHUB_MCP_URL = process.env.CUJO_GITHUB_MCP_URL ?? "http://github-mcp:8081/mcp";
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
    if (event.type === "model.message.delta") continue;
    events.push(event);
    if (event.type === "turn.done") break;
  }
  return events;
}

const turnCreated = (events: StreamEvent[]) =>
  events.find((e): e is TurnCreatedEvent => e.type === "turn.created");
const turnDone = (events: StreamEvent[]) =>
  events.find((e): e is TurnDoneEvent => e.type === "turn.done");
const outputText = (events: StreamEvent[]) => {
  const done = turnDone(events);
  if (done?.state.status !== "done") return "";
  const content = done.state.output?.content;
  return typeof content === "string" ? content : "";
};

describe.skipIf(!BASE_URL)("TrueForge contract", () => {
  let stub: StubModel;
  let harness: Harness;
  let sessionId: string;
  let firstTurn = "";
  let runner: Runner | undefined;

  beforeAll(async () => {
    stub = await startStubModel();
    const config = {
      trueforgeBaseUrl: BASE_URL,
      githubMcpUrl: GITHUB_MCP_URL,
      bootstrap: {
        modelProvider: {
          name: PROVIDER,
          baseUrl: `http://${STUB_HOST}:${stub.port}/v1`,
          apiKey: "stub",
          models: [{ name: "stub", modelId: "stub-1" }],
        },
        daytonaApiKey: null,
      },
    } as unknown as Config;
    harness = new Harness(config);
  });

  afterAll(async () => {
    // A failed assertion can leave a blocked run polling; stop it before the
    // stub goes away so nothing keeps calling the shared session.
    runner?.stopAll();
    await stub?.close();
  });

  it("bootstrap registers github-mcp and the model provider, twice without harm", async () => {
    const applied = await harness.bootstrap();
    expect(applied).toEqual(["mcp-server github-mcp", `model-provider ${PROVIDER}`]);
    expect(harness.ready).toBe(true);
    await harness.bootstrap();
    const { data } = await harness.client.settings.modelProviders.list();
    expect(data.filter((p) => p.name === PROVIDER)).toHaveLength(1);
  });

  it("creates a session from an inline agent spec that gates the blocking tool", async () => {
    sessionId = await harness.createSession({
      model: { name: MODEL },
      instructions: "Do what the user message says.",
      mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_blocking_review"] }],
      config: {
        sandbox: { enabled: false },
        askUserQuestions: { enabled: false },
        generativeUi: { enabled: false },
      },
    });
    expect(sessionId).toMatch(/\S+/);
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
    // The stream's model.message is a stub: the text is on turn.done only.
    const message = events.find((e) => e.type === "model.message");
    expect(message).toBeDefined();
    expect(message && "content" in message).toBe(false);
  });

  it("replays a finished turn in full on a later subscribe", async () => {
    const events = await collect(await harness.subscribe(sessionId, firstTurn));
    expect(turnCreated(events)?.turnId).toBe(firstTurn);
    expect(turnDone(events)?.state.status).toBe("done");
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
    expect(turns.map((t) => t.id)).toEqual(expect.arrayContaining([firstTurn, second]));
  });

  it("cancel ends the running turn as cancelled", async () => {
    const slow = await harness.startTurn(sessionId, "SLOW one");
    const streamPromise = harness.subscribe(sessionId, slow).then(collect);
    await new Promise((r) => setTimeout(r, 1500));
    await harness.cancelTurn(sessionId);
    const done = turnDone(await streamPromise);
    expect(done?.state.status).toBe("cancelled");
  });

  it("creating a turn while one runs cancels the old one, but its stream does not close", async () => {
    const slow = await harness.startTurn(sessionId, "SLOW two");
    const slowEvents = harness.subscribe(sessionId, slow).then(collect);
    await new Promise((r) => setTimeout(r, 1500));
    const next = await harness.startTurn(sessionId, "third");
    const nextEvents = await collect(await harness.subscribe(sessionId, next));
    expect(turnDone(nextEvents)?.state.status).toBe("done");

    // The old turn is cancelled on the server ...
    const old = (await harness.listTurns(sessionId)).find((t) => t.id === slow);
    expect(old?.state.status).toBe("cancelled");
    if (old?.state.status === "cancelled") {
      expect(old.state.reason).toBe("cancelled-for-next-turn");
    }
    // ... but a subscriber to it is never told (this is why the runner
    // cancels explicitly before starting a newer head's turn).
    const closed = await Promise.race([
      slowEvents.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 5_000)),
    ]);
    expect(closed).toBe(false);
  });

  const reviewMessage = (tool: string) =>
    `CALL call_tool {"mcp_server":"github-mcp","tool_name":"${tool}","input":${REVIEW_ARGS}}`;

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

  it("a review through call_tool: the model sees meta-tools, not the MCP tools", () => {
    const names = stub.requests.at(-1)?.tools?.map((t) => t.function.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["call_tool", "list_tools", "get_tool_info"]));
    expect(names.some((n) => n.endsWith("post_blocking_review"))).toBe(false);
    runner = new Runner(store.runs, harness, { turnTimeoutMs: 60_000, pollIntervalMs: 1_000 });
  });
  const active = (): Runner => {
    if (!runner) throw new Error("runner not built");
    return runner;
  };

  it("an advisory review folds to clean, even when github-mcp's GitHub call fails", async () => {
    const run = runFor("h-adv");
    await active().start(run, reviewMessage("post_advisory_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("clean");
    const projection = store.runs.getProjection(run.id);
    expect(projection?.review).toMatchObject({
      tool: "post_advisory_review",
      body: "Tests: fine.",
    });
    expect(projection?.summary).toBe("posted");
  });

  it("a blocking review pauses for approval; Cujo's allow posts it", async () => {
    const run = runFor("h-blk");
    await active().start(run, reviewMessage("post_blocking_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("blocked_pending");
    const projection = store.runs.getProjection(run.id);
    expect(projection?.review?.tool).toBe("post_blocking_review");
    expect(projection?.approval?.threadId).toBe("main");

    const decision = await active().approve(run.id, "allow", "op@example.com");
    expect(decision).toEqual({ ok: true });
    await settled(run.id, ["blocked_posted"]);
    expect(store.runs.getRun(run.id)).toMatchObject({ approver: "op@example.com" });
    expect(store.runs.getProjection(run.id)?.externalResume).toBe(false);
    expect(store.runs.getRun(run.id)?.turnIds).toHaveLength(2);
  });

  it("a denied blocking review folds to denied", async () => {
    const run = runFor("h-deny");
    await active().start(run, reviewMessage("post_blocking_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("blocked_pending");
    expect((await active().approve(run.id, "deny", "op@example.com")).ok).toBe(true);
    await settled(run.id, ["denied"]);
  });

  it("a sub-agent's name is the thread title, and its report trips a hard rule", async () => {
    const run = runFor("h-sub");
    const report = { check: "tests", base_pass_head_fail: ["t_x"] };
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
  });

  it("a resume sent outside Cujo is picked up by the poll and marked external", async () => {
    const run = runFor("h-ext");
    await active().start(run, reviewMessage("post_blocking_review"));
    const approval = store.runs.getProjection(run.id)?.approval;
    expect(approval).not.toBeNull();
    if (!approval) return;
    await harness.resume(sessionId, approval, "allow");
    await settled(run.id, ["blocked_posted"]);
    expect(store.runs.getRun(run.id)?.approver).toBe("external");
    expect(store.runs.getProjection(run.id)?.externalResume).toBe(true);
    active().stopAll();
  });
});
