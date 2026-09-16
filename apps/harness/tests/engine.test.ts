import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import type { BridgedServer } from "../src/mcp";
import { type Harness, collect, finished, harness, ofType, sleep, spec } from "./helpers";

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) h.engine.close();
});

async function up(overrides: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = await harness(overrides);
  open.push(h);
  return h;
}

describe("a plain turn", () => {
  it("chains turns, streams the reply, and lists events oldest first", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const first = await engine.createTurn(sessionId, [{ type: "user.message", content: "first" }]);
    const events = await collect(engine.subscribe(sessionId, first));
    const created = ofType(events, "turn.created")[0];
    expect(created?.turnId).toBe(first);
    expect(created?.previousTurnId).toBeNull();
    expect(
      ofType(events, "model.message.delta")
        .map((e) => e.content)
        .join(""),
    ).toBe("echo: first");
    const message = ofType(events, "model.message")[0];
    expect(message?.content).toBe("echo: first");
    expect(message?.usage?.inputTokens).toBe(10);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("done");
    if (done?.state.status === "done") {
      expect(done.state.output?.content).toBe("echo: first");
      expect(done.state.metrics?.totalInputTokens).toBe(10);
      expect(done.state.metrics?.totalCostInUsd).toBeUndefined();
    }

    const second = await engine.createTurn(sessionId, [
      { type: "user.message", content: "second" },
    ]);
    const more = await finished(engine, sessionId, second);
    expect(ofType(more, "turn.created")[0]?.previousTurnId).toBe(first);
    const listed = engine.listEvents(sessionId);
    expect(listed.map((item) => item.turnId)).toEqual([
      ...listed.filter((i) => i.turnId === first).map(() => first),
      ...listed.filter((i) => i.turnId === second).map(() => second),
    ]);
    expect(listed[0]?.event.type).toBe("turn.created");
    expect(engine.listTurns(sessionId).map((turn) => turn.id)).toEqual([first, second]);
  });

  it("replays a finished turn in full on a later subscribe and closes", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [{ type: "user.message", content: "hi" }]);
    await finished(engine, sessionId, turnId);
    const again = await finished(engine, sessionId, turnId);
    expect(again[0]?.type).toBe("turn.created");
    expect(again.at(-1)?.type).toBe("turn.done");
  });

  it("keeps the transcript across turns so the model sees the history", async () => {
    const { engine, stub } = await up();
    const sessionId = engine.createSession(spec());
    await finished(
      engine,
      sessionId,
      await engine.createTurn(sessionId, [{ type: "user.message", content: "one" }]),
    );
    await finished(
      engine,
      sessionId,
      await engine.createTurn(sessionId, [{ type: "user.message", content: "two" }]),
    );
    const last = stub.requests.at(-1);
    expect(last?.messages.filter((m) => m.role === "user").length).toBe(2);
    expect(last?.system).toContain("You review pull requests.");
  });

  it("refuses an unknown model at session creation", async () => {
    const { engine } = await up();
    expect(() => engine.createSession(spec({ model: { name: "stub/nope" } }))).toThrow(
      /Unknown model/,
    );
  });

  it("ends the turn as an error when the model errors past pi's retries", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: "ERROR quota exceeded" },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("error");
    if (done?.state.status === "error") expect(done.state.message).toBe("quota exceeded");
  });
});

describe("cancel and supersede", () => {
  it("cancel ends the running turn as client-cancelled", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [{ type: "user.message", content: "SLOW" }]);
    await sleep(100);
    await engine.cancel(sessionId);
    const events = await finished(engine, sessionId, turnId);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("cancelled");
    if (done?.state.status === "cancelled") expect(done.state.reason).toBe("client-cancelled");
  });

  it("a new turn ends the old one as cancelled-for-next-turn and its stream closes", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const first = await engine.createTurn(sessionId, [{ type: "user.message", content: "SLOW" }]);
    await sleep(100);
    const second = await engine.createTurn(sessionId, [{ type: "user.message", content: "next" }]);
    const events = await finished(engine, sessionId, first);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("cancelled");
    if (done?.state.status === "cancelled")
      expect(done.state.reason).toBe("cancelled-for-next-turn");
    const more = await finished(engine, sessionId, second);
    expect(ofType(more, "turn.done")[0]?.state.status).toBe("done");
    expect(engine.listTurns(sessionId).map((turn) => turn.state.status)).toEqual([
      "cancelled",
      "done",
    ]);
  });
});

describe("two turns back to back", () => {
  it("never run together: the second ends the first even while it is still opening", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const first = await engine.createTurn(sessionId, [{ type: "user.message", content: "SLOW" }]);
    const second = await engine.createTurn(sessionId, [{ type: "user.message", content: "next" }]);
    await finished(engine, sessionId, second);
    expect(engine.listTurns(sessionId).map((turn) => [turn.id, turn.state.status])).toEqual([
      [first, "cancelled"],
      [second, "done"],
    ]);
  });
});

describe("sub-agents", () => {
  it("a sub-agent's name is its thread title and its report lands before the parent's turn ends", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [
      {
        type: "user.message",
        content:
          'CALL create_sub_agent {"name":"tests","input":"SAY ```json {\\"check\\":\\"tests\\"} ```"}',
      },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const created = ofType(events, "thread.created")[0];
    expect(created?.title).toBe("tests");
    expect(created?.parent.threadId).toBe("main");
    const done = ofType(events, "thread.done")[0];
    expect(done?.state.status).toBe("done");
    if (done?.state.status === "done")
      expect(done.state.output.content).toContain('"check":"tests"');
    const types = events.map((event) => event.type);
    expect(types.indexOf("thread.done")).toBeLessThan(types.indexOf("tool.response"));
    expect(types.indexOf("tool.response")).toBeLessThan(types.lastIndexOf("turn.done"));
    const response = ofType(events, "tool.response")[0];
    expect(response?.toolName).toBe("create_sub_agent");
    expect(response?.content).toContain('"check":"tests"');
    const main = ofType(events, "model.message").filter((e) => e.threadId === "main");
    expect(main.at(-1)?.content).toBe("posted");
    const finish = ofType(events, "turn.done")[0];
    if (finish?.state.status === "done") expect(finish.state.metrics?.totalInputTokens).toBe(30);
  });

  it("gives a sub-agent its own instructions when the spec names its name (decision 165)", async () => {
    const { engine, stub } = await up();
    const sessionId = engine.createSession(
      spec({ subagents: { tests: "You run the tests and nothing else." } }),
    );
    const calls = ["tests", "helper"].map((name) => ({
      name: "create_sub_agent",
      args: { name, input: "SAY done" },
    }));
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: `CALLS ${JSON.stringify(calls)}` },
    ]);
    await finished(engine, sessionId, turnId);
    const systems = stub.requests.map((r) => r.system ?? "");
    expect(systems.filter((s) => s.includes("You run the tests and nothing else."))).toHaveLength(
      1,
    );
    // The parent and the unnamed child both read the parent's rubric.
    expect(
      systems.filter((s) => s.includes("You review pull requests.")).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("three sub-agents in one message run at once", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const calls = ["tests", "probes", "smoke"].map((name) => ({
      name: "create_sub_agent",
      args: { name, input: "SAY done" },
    }));
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: `CALLS ${JSON.stringify(calls)}` },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const createdAll = ofType(events, "thread.created").map((e) => e.title);
    expect(createdAll.sort()).toEqual(["probes", "smoke", "tests"]);
    const types = events.map((e) => e.type);
    // Every thread is created before any thread finishes: they ran together.
    expect(types.lastIndexOf("thread.created")).toBeLessThan(types.indexOf("thread.done"));
  });

  it("a sub-agent that errors reports an error thread and the parent goes on", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [
      {
        type: "user.message",
        content: 'CALL create_sub_agent {"name":"tests","input":"ERROR quota exceeded"}',
      },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const done = ofType(events, "thread.done")[0];
    expect(done?.state.status).toBe("error");
    expect(ofType(events, "tool.response")[0]?.isError).toBe(true);
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
  });

  it("cancelling the parent stops a running child", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL create_sub_agent {"name":"tests","input":"SLOW"}' },
    ]);
    await sleep(200);
    const started = Date.now();
    await engine.cancel(sessionId);
    expect(Date.now() - started).toBeLessThan(2_000);
    const events = await finished(engine, sessionId, turnId);
    expect(ofType(events, "thread.done")[0]?.state.status).toBe("error");
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("cancelled");
  });
});

describe("the iteration limit", () => {
  it("ends the turn as an error once the model has taken too many turns", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(
      spec({ config: { iterationLimit: 2, compaction: { enabled: false } } }),
    );
    // Every tool result asks for another call: an endless loop without the limit.
    const loop =
      'CALL create_sub_agent {"name":"x","input":"SAY CALL create_sub_agent {\\"name\\":\\"x\\",\\"input\\":\\"SAY loop\\"}"}';
    const turnId = await engine.createTurn(sessionId, [{ type: "user.message", content: loop }]);
    const events = await finished(engine, sessionId, turnId);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("error");
    if (done?.state.status === "error") expect(done.state.message).toContain("iteration limit 2");
  });
});

describe("the token budget", () => {
  it("ends the turn as an error once the billed tokens pass the budget", async () => {
    const { engine } = await up();
    // The stub bills 15 tokens a message, children included: the first main
    // message is under, the child's reply and the next main message are not.
    const sessionId = engine.createSession(
      spec({ config: { iterationLimit: 10, compaction: { enabled: false }, tokenBudget: 20 } }),
    );
    const loop =
      'CALL create_sub_agent {"name":"x","input":"SAY CALL create_sub_agent {\\"name\\":\\"x\\",\\"input\\":\\"SAY loop\\"}"}';
    const turnId = await engine.createTurn(sessionId, [{ type: "user.message", content: loop }]);
    const events = await finished(engine, sessionId, turnId);
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("error");
    if (done?.state.status === "error") {
      expect(done.state.message).toMatch(/^token budget exhausted: \d+ of 20$/);
      expect(done.state.metrics?.totalTokens).toBeGreaterThan(20);
    }
  });

  it("does not stop a turn that stays under it", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(
      spec({ config: { iterationLimit: 10, compaction: { enabled: false }, tokenBudget: 20 } }),
    );
    const turnId = await engine.createTurn(sessionId, [{ type: "user.message", content: "hi" }]);
    const events = await finished(engine, sessionId, turnId);
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
  });
});

// The gate needs a bridged server; a fake one avoids MCP here (mcp.test.ts covers the bridge).
function fakeServer(name: string, tools: ToolDefinition[]): BridgedServer {
  return { name, tools, close: async () => undefined };
}

function tool(name: string, gated: boolean, calls: string[] = []): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({ body: Type.Optional(Type.String()) }),
    ...(gated ? { executionMode: "sequential" as const } : {}),
    async execute(_id, params) {
      calls.push(name);
      return {
        content: [{ type: "text", text: JSON.stringify({ posted: name, ...(params as object) }) }],
        details: {},
      };
    },
  };
}

describe("the gate", () => {
  const gatedSpec = () =>
    spec({ mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["gated_tool"] }] });

  async function gatedHarness(calls: string[] = []) {
    const h = await up({
      connect: async (manifest) =>
        fakeServer(manifest.name, [
          tool("post_advisory_review", false, calls),
          tool("gated_tool", true, calls),
        ]),
    });
    h.store.putMcpServer({
      name: "github-mcp",
      url: "http://github-mcp:8081/mcp",
      description: "",
    });
    return h;
  }

  it("a gated call pauses the turn with the approval as its required action", async () => {
    const calls: string[] = [];
    const { engine } = await gatedHarness(calls);
    const sessionId = engine.createSession(gatedSpec());
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"malice"}' },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const required = ofType(events, "tool.approval_required")[0];
    expect(required?.threadId).toBe("main");
    const message = ofType(events, "model.message")[0];
    expect(required?.toolCalls[0]?.sourceEventId).toBe(message?.id);
    expect(message?.toolCalls?.[0]?.function.name).toBe("gated_tool");
    const done = ofType(events, "turn.done")[0];
    expect(done?.state.status).toBe("done");
    if (done?.state.status === "done") expect(done.state.requiredActions).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(engine.listTurns(sessionId)[0]?.state.status).toBe("done");
  });

  it("allow runs the held call with its original id and the next turn carries the response", async () => {
    const calls: string[] = [];
    const { engine, store } = await gatedHarness(calls);
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"malice"}' },
    ]);
    const paused = await finished(engine, sessionId, first);
    const toolCallId = ofType(paused, "tool.approval_required")[0]?.toolCalls[0]?.id as string;
    const second = await engine.createTurn(sessionId, [
      { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
    ]);
    const events = await finished(engine, sessionId, second);
    expect(ofType(events, "turn.created")[0]?.previousTurnId).toBe(first);
    const response = ofType(events, "tool.response")[0];
    expect(response?.toolCallId).toBe(toolCallId);
    expect(response?.content).toContain('"posted":"gated_tool"');
    expect(calls).toEqual(["gated_tool"]);
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
    expect(store.getApproval(toolCallId)?.status).toBe("allowed");
  });

  it("deny hands the model the reason as the tool result", async () => {
    const calls: string[] = [];
    const { engine, stub } = await gatedHarness(calls);
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"malice"}' },
    ]);
    const paused = await finished(engine, sessionId, first);
    const toolCallId = ofType(paused, "tool.approval_required")[0]?.toolCalls[0]?.id as string;
    const second = await engine.createTurn(sessionId, [
      {
        type: "user.tool_approval",
        threadId: "main",
        toolCallId,
        approval: { status: "deny", reason: "Rejected by an operator." },
      },
    ]);
    const events = await finished(engine, sessionId, second);
    expect(calls).toEqual([]);
    const response = ofType(events, "tool.response")[0];
    expect(response?.isError).toBe(true);
    expect(response?.content).toBe("Rejected by an operator.");
    const last = stub.requests.at(-1)?.messages.at(-1);
    expect(last?.role).toBe("toolResult");
    if (last?.role === "toolResult")
      expect(last.content[0]).toEqual({ type: "text", text: "Rejected by an operator." });
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
  });

  it("an advisory in the same message as the gated call posts before the pause", async () => {
    const calls: string[] = [];
    const { engine } = await gatedHarness(calls);
    const sessionId = engine.createSession(gatedSpec());
    const both = JSON.stringify([
      { name: "post_advisory_review", args: { body: "observation" } },
      { name: "gated_tool", args: { body: "accusation" } },
    ]);
    const turnId = await engine.createTurn(sessionId, [
      { type: "user.message", content: `CALLS ${both}` },
    ]);
    const events = await finished(engine, sessionId, turnId);
    const types = events.map((e) => e.type);
    expect(calls).toEqual(["post_advisory_review"]);
    expect(types.indexOf("tool.response")).toBeLessThan(types.indexOf("tool.approval_required"));
  });

  it("a second decision is refused with the first one's status", async () => {
    const { engine } = await gatedHarness();
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
    ]);
    const toolCallId = ofType(await finished(engine, sessionId, first), "tool.approval_required")[0]
      ?.toolCalls[0]?.id as string;
    const approval = {
      type: "user.tool_approval" as const,
      threadId: "main",
      toolCallId,
      approval: { status: "allow" as const },
    };
    await finished(engine, sessionId, await engine.createTurn(sessionId, [approval]));
    await expect(engine.createTurn(sessionId, [approval])).rejects.toMatchObject({
      status: 409,
      body: { status: "allowed" },
    });
  });

  it("a new user turn voids the pending approval and a later answer is refused", async () => {
    const { engine, store } = await gatedHarness();
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
    ]);
    const toolCallId = ofType(await finished(engine, sessionId, first), "tool.approval_required")[0]
      ?.toolCalls[0]?.id as string;
    const second = await engine.createTurn(sessionId, [
      { type: "user.message", content: "next head" },
    ]);
    await finished(engine, sessionId, second);
    expect(store.getApproval(toolCallId)?.status).toBe("superseded");
    // The paused turn keeps its `done` state; the abort is not a second ending.
    expect(engine.listTurns(sessionId).map((t) => t.state.status)).toEqual(["done", "done"]);
    await expect(
      engine.createTurn(sessionId, [
        { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
      ]),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("a held call released by an abort leaves no tool.response behind", async () => {
    const { engine } = await gatedHarness();
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
    ]);
    const toolCallId = ofType(await finished(engine, sessionId, first), "tool.approval_required")[0]
      ?.toolCalls[0]?.id as string;
    const second = await engine.createTurn(sessionId, [
      { type: "user.message", content: "next head" },
    ]);
    await finished(engine, sessionId, second);
    const responses = engine
      .listEvents(sessionId)
      .filter((item) => item.event.type === "tool.response")
      .map((item) => (item.event as { toolCallId: string }).toolCallId);
    expect(responses).not.toContain(toolCallId);
  });

  it("cancel while suspended releases the held call", async () => {
    const { engine, store } = await gatedHarness();
    const sessionId = engine.createSession(gatedSpec());
    const first = await engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
    ]);
    const toolCallId = ofType(await finished(engine, sessionId, first), "tool.approval_required")[0]
      ?.toolCalls[0]?.id as string;
    const started = Date.now();
    await engine.cancel(sessionId);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(store.getApproval(toolCallId)?.status).toBe("superseded");
  });

  describe("after a restart", () => {
    it("deny after a restart tells the model the reason in a new turn", async () => {
      const calls: string[] = [];
      const h = await gatedHarness(calls);
      const sessionId = h.engine.createSession(gatedSpec());
      const first = await h.engine.createTurn(sessionId, [
        { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
      ]);
      const toolCallId = ofType(
        await finished(h.engine, sessionId, first),
        "tool.approval_required",
      )[0]?.toolCalls[0]?.id as string;
      h.engine = new Engine({
        store: h.store,
        models: h.models,
        dataDir: h.dataDir,
        log: (h.engine as unknown as { log: never }).log,
        connect: async (manifest) =>
          fakeServer(manifest.name, [
            tool("post_advisory_review", false, calls),
            tool("gated_tool", true, calls),
          ]),
      });
      h.engine.boot();
      const second = await h.engine.createTurn(sessionId, [
        {
          type: "user.tool_approval",
          threadId: "main",
          toolCallId,
          approval: { status: "deny", reason: "No." },
        },
      ]);
      const events = await finished(h.engine, sessionId, second);
      expect(calls).toEqual([]);
      expect(ofType(events, "model.message")[0]?.content).toContain(
        "rejected your gated_tool call",
      );
      expect(h.store.getApproval(toolCallId)?.status).toBe("denied");
    });

    it("a re-call with different arguments is gated again", async () => {
      const calls: string[] = [];
      const h = await gatedHarness(calls);
      const sessionId = h.engine.createSession(gatedSpec());
      const first = await h.engine.createTurn(sessionId, [
        { type: "user.message", content: 'CALL gated_tool {"body":"m","mutate":true}' },
      ]);
      const toolCallId = ofType(
        await finished(h.engine, sessionId, first),
        "tool.approval_required",
      )[0]?.toolCalls[0]?.id as string;
      h.engine = new Engine({
        store: h.store,
        models: h.models,
        dataDir: h.dataDir,
        log: (h.engine as unknown as { log: never }).log,
        connect: async (manifest) =>
          fakeServer(manifest.name, [
            tool("post_advisory_review", false, calls),
            tool("gated_tool", true, calls),
          ]),
      });
      h.engine.boot();
      const second = await h.engine.createTurn(sessionId, [
        { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
      ]);
      const events = await finished(h.engine, sessionId, second);
      // The model came back with a different body: not what was approved, so it pauses again.
      expect(calls).toEqual([]);
      const required = ofType(events, "tool.approval_required")[0];
      expect(required).toBeDefined();
      expect(required?.toolCalls[0]?.id).not.toBe(toolCallId);
      expect(h.store.getApproval(required?.toolCalls[0]?.id as string)?.status).toBe("pending");
    });

    it("allow re-calls: the model is asked to repeat the call and the gate lets it through once", async () => {
      const calls: string[] = [];
      const h = await gatedHarness(calls);
      const sessionId = h.engine.createSession(gatedSpec());
      const first = await h.engine.createTurn(sessionId, [
        { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
      ]);
      const toolCallId = ofType(
        await finished(h.engine, sessionId, first),
        "tool.approval_required",
      )[0]?.toolCalls[0]?.id as string;
      // The process dies with the call held: the pi session is dropped without
      // an abort, and a new engine comes up over the same data directory.
      h.engine = new Engine({
        store: h.store,
        models: h.models,
        dataDir: h.dataDir,
        log: (h.engine as unknown as { log: never }).log,
        connect: async (manifest) =>
          fakeServer(manifest.name, [
            tool("post_advisory_review", false, calls),
            tool("gated_tool", true, calls),
          ]),
      });
      h.engine.boot();
      const second = await h.engine.createTurn(sessionId, [
        { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
      ]);
      // The model, told to repeat itself, repeats itself; the gate lets that one through.
      const events = await finished(h.engine, sessionId, second);
      expect(calls).toEqual(["gated_tool"]);
      const response = ofType(events, "tool.response")[0];
      expect(response?.toolName).toBe("gated_tool");
      expect(response?.toolCallId).not.toBe(toolCallId);
      expect(ofType(events, "tool.approval_required")).toHaveLength(0);
      // The dangling call got exactly one synthetic result, and the model saw it.
      const results = h.stub.requests.at(-1)?.messages.filter((m) => m.role === "toolResult") ?? [];
      const synthetic = results.filter(
        (m) => m.role === "toolResult" && m.toolCallId === toolCallId,
      );
      expect(synthetic).toHaveLength(1);
      expect(
        synthetic[0] && "content" in synthetic[0] ? synthetic[0].content[0] : null,
      ).toMatchObject({
        text: expect.stringContaining("restarted"),
      });
      expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
      expect(h.store.getApproval(toolCallId)?.status).toBe("allowed");
    });
  });
});

describe("shutdown", () => {
  it("leaves a held approval pending and the run for the next boot", async () => {
    const calls: string[] = [];
    const h = await up({
      connect: async (manifest) =>
        fakeServer(manifest.name, [
          tool("post_advisory_review", false, calls),
          tool("gated_tool", true, calls),
        ]),
    });
    h.store.putMcpServer({
      name: "github-mcp",
      url: "http://github-mcp:8081/mcp",
      description: "",
    });
    const sessionId = h.engine.createSession(
      spec({
        mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["gated_tool"] }],
      }),
    );
    const first = await h.engine.createTurn(sessionId, [
      { type: "user.message", content: 'CALL gated_tool {"body":"m"}' },
    ]);
    const toolCallId = ofType(
      await finished(h.engine, sessionId, first),
      "tool.approval_required",
    )[0]?.toolCalls[0]?.id as string;
    // The process goes down with the call held.
    h.engine.close();
    expect(h.store.getApproval(toolCallId)?.status).toBe("pending");
    expect(h.store.getTurn(first)?.state.status).toBe("done");
    // The next process answers it through the re-call path.
    h.engine = new Engine({
      store: h.store,
      models: h.models,
      dataDir: h.dataDir,
      log: (h.engine as unknown as { log: never }).log,
      connect: async (manifest) =>
        fakeServer(manifest.name, [
          tool("post_advisory_review", false, calls),
          tool("gated_tool", true, calls),
        ]),
    });
    h.engine.boot();
    const second = await h.engine.createTurn(sessionId, [
      { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
    ]);
    const events = await finished(h.engine, sessionId, second);
    expect(calls).toEqual(["gated_tool"]);
    expect(ofType(events, "turn.done")[0]?.state.status).toBe("done");
  });

  it("leaves a running turn running, for boot to end as an error", async () => {
    const h = await up();
    const sessionId = h.engine.createSession(spec());
    const turnId = await h.engine.createTurn(sessionId, [
      { type: "user.message", content: "SLOW" },
    ]);
    await sleep(100);
    h.engine.close();
    await sleep(100);
    expect(h.store.getTurn(turnId)?.state.status).toBe("running");
    expect(
      h.store.listTurnEvents(sessionId, turnId).some((i) => i.event.type === "turn.done"),
    ).toBe(false);
  });
});

describe("boot", () => {
  it("ends a turn that was running when the process died as an error", async () => {
    const h = await up();
    const sessionId = h.engine.createSession(spec());
    const turnId = await h.engine.createTurn(sessionId, [
      { type: "user.message", content: "SLOW" },
    ]);
    await sleep(100);
    const fresh = new Engine({
      store: h.store,
      models: h.models,
      dataDir: h.dataDir,
      log: (h.engine as unknown as { log: never }).log,
    });
    fresh.boot();
    expect(h.store.getTurn(turnId)?.state).toMatchObject({
      status: "error",
      message: "harness restarted",
    });
    const events = h.store.listTurnEvents(sessionId, turnId);
    expect(events.at(-1)?.event.type).toBe("turn.done");
  });
});

describe("listEvents", () => {
  it("returns every event, past a hundred", async () => {
    const { engine } = await up();
    const sessionId = engine.createSession(spec());
    for (let i = 0; i < 40; i += 1) {
      await finished(
        engine,
        sessionId,
        await engine.createTurn(sessionId, [{ type: "user.message", content: `m${i}` }]),
      );
    }
    // 40 turns x (turn.created, model.message, turn.done)
    expect(engine.listEvents(sessionId).length).toBe(120);
    expect(engine.listEvents(sessionId, 100).length).toBe(20);
  });
});
