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
          // Declared so the session below can ask for one. Without this the
          // server rejects any `reasoningEffort` and createSession throws --
          // which is exactly what shipped, because this test used to create a
          // session with no `params` at all and so never touched that path
          // (decision 56).
          reasoningEfforts: ["none", "low"],
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

  it("creates a session from an inline agent spec that gates the accusation", async () => {
    sessionId = await harness.createSession({
      // `params` is the half CI never exercised. A spec naming an effort the
      // provider does not declare is refused at creation, and production found
      // that out as a 502 on every webhook.
      model: { name: MODEL, params: { reasoningEffort: "low" } },
      instructions: "Do what the user message says.",
      mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_gated_review"] }],
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
    expect(names.some((n) => n.endsWith("post_gated_review"))).toBe(false);
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

  it("a gated review pauses for approval; Cujo's allow posts it", async () => {
    const run = runFor("h-blk");
    await active().start(run, reviewMessage("post_gated_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("blocked_pending");
    const projection = store.runs.getProjection(run.id);
    expect(projection?.gatedReview?.tool).toBe("post_gated_review");
    expect(projection?.approval?.threadId).toBe("main");

    const decision = await active().approve(run.id, "allow", "op@example.com");
    expect(decision).toEqual({ ok: true });
    await settled(run.id, ["blocked_posted"]);
    expect(store.runs.getRun(run.id)).toMatchObject({ approver: "op@example.com" });
    expect(store.runs.getProjection(run.id)?.externalResume).toBe(false);
    expect(store.runs.getRun(run.id)?.turnIds).toHaveLength(2);
  });

  it("a denied accusation folds to denied", async () => {
    const run = runFor("h-deny");
    await active().start(run, reviewMessage("post_gated_review"));
    expect(store.runs.getRun(run.id)?.status).toBe("blocked_pending");
    expect((await active().approve(run.id, "deny", "op@example.com")).ok).toBe(true);
    await settled(run.id, ["denied"]);
  });

  /**
   * The regression behind decision 39, and the only test that exercises the
   * refusal itself. An approval is outstanding on the session, not on the turn
   * that raised it, so before the fix `supersede`'s cancel left it pending and
   * every later head on that pull request failed to start a turn with
   * `422 user message cannot be sent while approvals or questions are pending`.
   */
  it("a superseded accusation leaves the session able to take the next head's turn", async () => {
    const stale = runFor("h-stale");
    await active().start(stale, reviewMessage("post_gated_review"));
    expect(store.runs.getRun(stale.id)?.status).toBe("blocked_pending");

    // What the webhook does when a newer commit arrives while a human is
    // still being asked about the old one.
    await active().supersede(stale.id);
    expect(store.runs.getRun(stale.id)?.status).toBe("superseded");
    // Nobody decided it, so it must not read as a run someone turned down.
    expect(store.runs.getRun(stale.id)?.approver).toBeNull();

    const next = runFor("h-next");
    await active().start(next, reviewMessage("post_advisory_review"));
    expect(store.runs.getProjection(next.id)?.error).toBeNull();
    expect(store.runs.getRun(next.id)?.status).toBe("clean");
  });

  it("a sub-agent's name is the thread title, and its report trips a hard rule", async () => {
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
  });

  it("a resume sent outside Cujo is picked up by the poll and marked external", async () => {
    const run = runFor("h-ext");
    await active().start(run, reviewMessage("post_gated_review"));
    const approval = store.runs.getProjection(run.id)?.approval;
    expect(approval).not.toBeNull();
    if (!approval) return;
    await harness.resume(sessionId, approval, "allow");
    await settled(run.id, ["blocked_posted"]);
    expect(store.runs.getRun(run.id)?.approver).toBe("external");
    expect(store.runs.getProjection(run.id)?.externalResume).toBe(true);
    active().stopAll();
  });

  /**
   * The wedge behind the orders-api#18 incident, pinned in full because every
   * intuition about it turned out to be wrong.
   *
   * A run whose stream is lost ends on a synthetic terminal (`consume`, when
   * every resubscribe is spent) while its turn keeps running. The next run on
   * the pull request then cannot start, and the four facts below say why no
   * obvious remedy works:
   *
   * - a *running* turn does not wedge a session at all; the cancel test above
   *   shows a second turn simply supersedes it. Running **sub-agents** do.
   * - the refused `startTurn` **cancels the turn on its way out**, so by the
   *   time a heal looks, nothing is `running` and the wedge is invisible in
   *   `listTurns`.
   * - `cancelTurn` does **not** clear it. The sub-agents outlive their turn.
   * - an empty-input turn **is** accepted while a message is refused, which is
   *   what the 422 text itself advises.
   *
   * Last in the file on purpose: it holds a session open, and the tests above
   * read `stub.requests.at(-1)`.
   */
  it("a running sub-agent wedges the session, and only empty input is accepted", async () => {
    // Its own session, spec-identical to the shared one -- `create_sub_agent`
    // is only offered when the spec declares an MCP server.
    const wedged = await harness.createSession({
      model: { name: MODEL, params: { reasoningEffort: "low" } },
      instructions: "Do what the user message says.",
      mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_gated_review"] }],
      config: {
        sandbox: { enabled: false },
        askUserQuestions: { enabled: false },
        generativeUi: { enabled: false },
      },
    });
    const statusOf = async (id: string) =>
      (await harness.listTurns(wedged)).find((t) => t.id === id)?.state.status;
    const tryTurn = async (input: string) =>
      await harness.startTurn(wedged, input).then(
        () => "started",
        (error: unknown) => String(error),
      );

    // The parent spawns a sub-agent whose own prompt is SLOW, so the child
    // holds the session while the parent waits on it. The parent's prompt
    // carries that SLOW too, which is why the stub exempts a planned call.
    const spawn = `CALL create_sub_agent ${JSON.stringify({ name: "tests", input: "SLOW" })}`;
    const before = stub.requests.length;
    const parent = await harness.startTurn(wedged, spawn);
    await new Promise((r) => setTimeout(r, 5_000));
    // Guard the premise: without the spawn tool the stub answers with plain
    // text, nothing runs, and everything below passes vacuously. The second
    // request is the child, which is the one still sleeping.
    const mine = stub.requests.slice(before);
    expect(mine[0]?.tools?.map((t) => t.function.name)).toContain("create_sub_agent");
    expect(mine.length).toBeGreaterThan(1);
    expect(await statusOf(parent)).toBe("running");

    // The incident: the session refuses the next head's turn.
    expect(await tryTurn("second")).toContain("422");
    // ... and the refusal cancelled the turn on its way out, so a heal that
    // looks for a running turn finds nothing to act on.
    expect(await statusOf(parent)).toBe("cancelled");
    // Cancelling does not release the session: the sub-agents outlive it.
    await harness.cancelTurn(wedged);
    expect(await tryTurn("third")).toContain("422");
    // Empty input is the one thing the session still accepts.
    await expect(harness.client.sessions.createTurn(wedged, { input: [] })).resolves.toBeDefined();
  }, 120_000);
});
