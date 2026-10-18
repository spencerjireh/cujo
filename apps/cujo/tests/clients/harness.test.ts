import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { Harness, HarnessRequestError, readSse } from "../../src/clients/harness";
import type { Config } from "../../src/config";

const config = {
  harnessBaseUrl: "http://harness:8790/",
  githubMcpUrl: "http://github-mcp:8081/mcp",
  sandboxMcpUrl: "http://sandbox-mcp:8082/mcp",
  turnTimeoutMs: 1000,
  bootstrap: {
    modelProviders: [
      {
        kind: "openai",
        name: "p",
        baseUrl: "http://llm/v1",
        apiKey: "k",
        models: [{ name: "m", modelId: "m-1" }],
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: true,
      },
    ],
  },
} as unknown as Config;

const log = createLogger({ service: "cujo", level: "error", sink: () => undefined });

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(
  answer: (call: Call) => { status?: number; body?: unknown; stream?: string } = () => ({}),
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, body = { ok: true }, stream } = answer(call);
    if (stream !== undefined) {
      return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const anthropic = { kind: "anthropic", name: "anthropic", apiKey: "sk-ant" } as const;

describe("Harness.registerModelProvider (decisions 152, 174)", () => {
  it("upserts the providers the accessor names, so a runtime change reaches the harness", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const h = new Harness(config, log, fetchImpl);
    const base = config.bootstrap.modelProviders[0];
    if (base?.kind !== "openai") throw new Error("fixture has no provider");
    const provider = { ...base, name: "other", apiKey: "k2" };
    h.modelProviders = () => [provider, anthropic];
    await h.registerModelProvider(provider);
    expect(calls[0]?.body).toMatchObject({ kind: "openai", name: "other", apiKey: "k2" });
    expect(h.isRegistered("other")).toBe(true);
    // Bootstrap reads the same accessor, and an anthropic provider is its key.
    await h.bootstrap();
    expect(calls.at(-1)?.body).toEqual(anthropic);
    expect(h.isRegistered("anthropic")).toBe(true);
  });
});

describe("Harness.syncModelProviders (decision 174)", () => {
  it("puts what is new or changed and deletes what is gone", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const h = new Harness(config, log, fetchImpl);
    const [p] = config.bootstrap.modelProviders;
    if (!p) throw new Error("fixture has no provider");
    await h.syncModelProviders([p, anthropic], [{ ...anthropic, apiKey: "sk-ant-2" }]);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["PUT", "http://harness:8790/settings/model-providers"],
      ["DELETE", "http://harness:8790/settings/model-providers/p"],
    ]);
    expect(h.isRegistered("p")).toBe(false);
    expect(h.isRegistered("anthropic")).toBe(true);
  });

  it("applies the rest when one fails, and names the one that did", async () => {
    const { calls, fetchImpl } = fakeFetch((call) =>
      call.method === "PUT" ? { status: 500, body: { error: "boom" } } : {},
    );
    const h = new Harness(config, log, fetchImpl);
    const [p] = config.bootstrap.modelProviders;
    if (!p) throw new Error("fixture has no provider");
    await expect(h.syncModelProviders([p], [anthropic])).rejects.toThrow(
      "providers not synced: anthropic",
    );
    expect(calls.map((c) => c.method)).toEqual(["PUT", "DELETE"]);
  });
});

describe("Harness provider questions (decision 174)", () => {
  it("asks for models and for a test with the provider's manifest", async () => {
    const { calls, fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/models")
        ? { body: { models: [{ id: "claude-sonnet-5", costKnown: true }] } }
        : { body: { ok: true, latencyMs: 12 } },
    );
    const h = new Harness(config, log, fetchImpl);
    expect(await h.listProviderModels(anthropic)).toEqual([
      { id: "claude-sonnet-5", costKnown: true },
    ]);
    expect(await h.testProvider(anthropic, "claude-sonnet-5")).toEqual({ ok: true, latencyMs: 12 });
    expect(calls[1]?.body).toEqual({ manifest: anthropic, model: "claude-sonnet-5" });
    expect(h.isRegistered("anthropic")).toBe(false);
  });
});

describe("Harness.bootstrap", () => {
  it("upserts both MCP servers and the model provider, and is ready only after all three", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const h = new Harness(config, log, fetchImpl);
    expect(await h.bootstrap()).toEqual([
      "mcp-server github-mcp",
      "mcp-server sandbox-mcp",
      "model-provider p",
    ]);
    expect(h.ready).toBe(true);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["PUT", "http://harness:8790/settings/mcp-servers"],
      ["PUT", "http://harness:8790/settings/mcp-servers"],
      ["PUT", "http://harness:8790/settings/model-providers"],
    ]);
    // What the harness needs about each model (decision 127), nothing else.
    expect(calls[2]?.body).toEqual({
      kind: "openai",
      name: "p",
      baseUrl: "http://llm/v1",
      apiKey: "k",
      models: [
        { name: "m", modelId: "m-1", contextWindow: 128_000, maxTokens: 16_384, reasoning: true },
      ],
    });
  });

  it("names the failed step and stays not ready", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/model-providers") ? { status: 400, body: { error: "invalid body" } } : {},
    );
    const h = new Harness(config, log, fetchImpl);
    await expect(h.bootstrap()).rejects.toThrow(/bootstrap step model-provider p failed.*400/);
    expect(h.ready).toBe(false);
  });

  it("retries until the whole bootstrap succeeds", async () => {
    let failures = 1;
    const { calls, fetchImpl } = fakeFetch((call) => {
      if (call.url.endsWith("/model-providers") && failures-- > 0) return { status: 500 };
      return {};
    });
    const h = new Harness(config, log, fetchImpl);
    await h.bootstrapUntilReady(async () => undefined);
    expect(h.ready).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/model-providers"))).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith("/mcp-servers"))).toHaveLength(4);
  });
});

describe("Harness turns", () => {
  it("creates a session and starts a turn", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { id: "x1" } }));
    const h = new Harness(config, log, fetchImpl);
    expect(await h.createSession({ model: { name: "p/m" } } as never)).toBe("x1");
    expect(await h.startTurn("s", "hi")).toBe("x1");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "http://harness:8790/sessions", { spec: { model: { name: "p/m" } } }],
      [
        "POST",
        "http://harness:8790/sessions/s/turns",
        { input: [{ type: "user.message", content: "hi" }] },
      ],
    ]);
  });

  it("surfaces a refusal with its status and body", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 409,
      body: { error: "approval is allowed", status: "allowed" },
    }));
    const h = new Harness(config, log, fetchImpl);
    const error = await h.startTurn("s", "hi").catch((e) => e);
    expect(error).toBeInstanceOf(HarnessRequestError);
    expect(error.status).toBe(409);
    expect(error.body.status).toBe("allowed");
  });

  it("lists events and turns as the harness returns them, oldest first and uncapped", async () => {
    const event = {
      type: "turn.created",
      id: "e",
      createdAt: "t",
      threadId: "main",
      turnId: "t1",
      previousTurnId: null,
      input: [],
    };
    const { calls, fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/events")
        ? { body: [{ seq: 1, turnId: "t1", event }] }
        : {
            body: [
              {
                id: "t1",
                sessionId: "s",
                createdAt: "t",
                previousTurnId: null,
                state: { status: "running" },
                input: [],
              },
            ],
          },
    );
    const h = new Harness(config, log, fetchImpl);
    expect(await h.listEvents("s")).toEqual([{ turnId: "t1", event }]);
    expect((await h.listTurns("s")).map((t) => t.id)).toEqual(["t1"]);
    expect(calls.map((c) => c.url)).toEqual([
      "http://harness:8790/sessions/s/events",
      "http://harness:8790/sessions/s/turns",
    ]);
  });

  it("subscribes over SSE and yields each event frame, ignoring keepalives", async () => {
    const frames = [
      'event: event\nid: 0\ndata: {"type":"turn.created","id":"e1","createdAt":"t","threadId":"main","turnId":"t1","previousTurnId":null,"input":[]}\n\n',
      "event: keepalive\ndata: \n\n",
      'event: event\nid: 1\ndata: {"type":"model.message.delta","id":"e2","createdAt":"t","threadId":"main","content":"hi"}\n\n',
      'event: event\nid: 2\ndata: {"type":"turn.done","id":"e3","createdAt":"t","threadId":"main","state":{"status":"done","completedAt":"t","output":null,"requiredActions":[]}}\n\n',
    ];
    const { calls, fetchImpl } = fakeFetch(() => ({ stream: frames.join("") }));
    const h = new Harness(config, log, fetchImpl);
    const events = [];
    for await (const event of await h.subscribe("s", "t1")) events.push(event.type);
    expect(events).toEqual(["turn.created", "model.message.delta", "turn.done"]);
    expect(calls[0]?.url).toBe("http://harness:8790/sessions/s/turns/t1/subscribe");
  });

  it("cancel posts to the session", async () => {
    const { calls, fetchImpl } = fakeFetch();
    await new Harness(config, log, fetchImpl).cancelTurn("s");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "http://harness:8790/sessions/s/cancel",
    });
  });
});

describe("readSse", () => {
  it("reassembles frames split across chunks", async () => {
    const text =
      'event: event\ndata: {"type":"turn.done","id":"e3","createdAt":"t","threadId":"main","state":{"status":"error","completedAt":"t","message":"x"}}\n\n';
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text.slice(0, 20)));
        controller.enqueue(encoder.encode(text.slice(20)));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readSse(body)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("turn.done");
  });
});
