import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http";
import { type Harness, harness, spec } from "./helpers";

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) h.engine.close();
});

async function app(fetch?: typeof globalThis.fetch) {
  const h = await harness();
  open.push(h);
  const log = (h.engine as unknown as { log: never }).log;
  const hono = createApp({
    engine: h.engine,
    store: h.store,
    models: h.models,
    log,
    ...(fetch ? { fetch } : {}),
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await hono.request(path, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
        : {}),
    });
    // biome-ignore lint/suspicious/noExplicitAny: test bodies are asserted loosely
    const json: any = response.headers.get("content-type")?.includes("json")
      ? await response.json().catch(() => null)
      : null;
    return { status: response.status, json, response };
  };
  return { ...h, hono, call };
}

describe("the HTTP surface", () => {
  it("registers settings and creates a session", async () => {
    const { call } = await app();
    expect(
      (
        await call("PUT", "/settings/mcp-servers", {
          name: "sandbox-mcp",
          url: "http://s:8082/mcp",
          description: "",
        })
      ).status,
    ).toBe(200);
    const bad = await call("PUT", "/settings/model-providers", { name: "p" });
    expect(bad.status).toBe(400);
    expect(bad.json.issues.length).toBeGreaterThan(0);
    const created = await call("POST", "/sessions", {
      spec: spec({ mcpServers: [{ name: "sandbox-mcp", requireApprovalForTools: [] }] }),
    });
    expect(created.status).toBe(201);
    expect(typeof created.json.id).toBe("string");
    const unknown = await call("POST", "/sessions", {
      spec: spec({ mcpServers: [{ name: "nope", requireApprovalForTools: [] }] }),
    });
    expect(unknown.status).toBe(400);
    const model = await call("POST", "/sessions", { spec: spec({ model: { name: "stub/nope" } }) });
    expect(model.status).toBe(400);
    expect(model.json.error).toContain("Unknown model");
  });

  it("answers 404 for an unknown session and turn", async () => {
    const { call } = await app();
    expect((await call("GET", "/sessions/nope/turns")).status).toBe(404);
    expect((await call("GET", "/sessions/nope/events")).status).toBe(404);
    expect(
      (
        await call("POST", "/sessions/nope/turns", {
          input: [{ type: "user.message", content: "x" }],
        })
      ).status,
    ).toBe(404);
    const { json } = await call("POST", "/sessions", { spec: spec() });
    expect((await call("GET", `/sessions/${json.id}/turns/nope/subscribe`)).status).toBe(404);
  });

  it("runs a turn and streams it as SSE, then lists it", async () => {
    const { call } = await app();
    const session = (await call("POST", "/sessions", { spec: spec() })).json.id as string;
    const turn = await call("POST", `/sessions/${session}/turns`, {
      input: [{ type: "user.message", content: "hi" }],
    });
    expect(turn.status).toBe(201);
    const stream = await call("GET", `/sessions/${session}/turns/${turn.json.id}/subscribe`);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await stream.response.text();
    const frames = text
      .split("\n\n")
      .filter((frame) => frame.includes("event: event"))
      .map((frame) =>
        JSON.parse(
          frame
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6) ?? "null",
        ),
      );
    expect(frames[0]?.type).toBe("turn.created");
    expect(frames.some((f) => f.type === "model.message.delta")).toBe(true);
    expect(frames.at(-1)?.type).toBe("turn.done");
    const turns = await call("GET", `/sessions/${session}/turns`);
    expect(turns.json[0]).toMatchObject({
      id: turn.json.id,
      previousTurnId: null,
      state: { status: "done" },
    });
    const events = await call("GET", `/sessions/${session}/events?afterSeq=1`);
    expect(events.json.length).toBe(2);
    expect((await call("GET", `/sessions/${session}/events?afterSeq=-1`)).status).toBe(400);
  });

  it("refuses a decided approval with 409 and the status", async () => {
    const { call } = await app();
    const session = (await call("POST", "/sessions", { spec: spec() })).json.id as string;
    const refused = await call("POST", `/sessions/${session}/turns`, {
      input: [
        {
          type: "user.tool_approval",
          threadId: "main",
          toolCallId: "nope",
          approval: { status: "allow" },
        },
      ],
    });
    expect(refused.status).toBe(404);
  });

  it("cancel on an idle session is a no-op", async () => {
    const { call } = await app();
    const session = (await call("POST", "/sessions", { spec: spec() })).json.id as string;
    expect((await call("POST", `/sessions/${session}/cancel`)).status).toBe(200);
  });
});

describe("model providers", () => {
  const anthropic = { kind: "anthropic", name: "anthropic", apiKey: "sk-ant-x" };

  it("registers an anthropic key and resolves catalog models by id", async () => {
    const { call, store } = await app();
    expect((await call("PUT", "/settings/model-providers", anthropic)).status).toBe(200);
    expect(store.listModelProviders()).toEqual([anthropic]);
    const created = await call("POST", "/sessions", {
      spec: spec({ model: { name: "anthropic/claude-sonnet-5" } }),
    });
    expect(created.status).toBe(201);
  });

  it("removes a provider from the store and from resolution", async () => {
    const { call, store } = await app();
    await call("PUT", "/settings/model-providers", anthropic);
    expect((await call("DELETE", "/settings/model-providers/anthropic")).status).toBe(200);
    expect(store.listModelProviders()).toEqual([]);
    const created = await call("POST", "/sessions", {
      spec: spec({ model: { name: "anthropic/claude-sonnet-5" } }),
    });
    expect(created.status).toBe(400);
  });

  it("lists the catalog for anthropic and a host's /models for openai", async () => {
    const fake = (async (url: string) => {
      expect(url).toBe("http://host.invalid/v1/models");
      return Response.json({ data: [{ id: "a/b", context_length: 32_000 }, { id: 7 }] });
    }) as unknown as typeof fetch;
    const { call } = await app(fake);
    const catalog = await call("POST", "/settings/model-providers/models", { manifest: anthropic });
    expect(catalog.json.models).toContainEqual(
      expect.objectContaining({ id: "claude-sonnet-5", costKnown: true }),
    );
    const listed = await call("POST", "/settings/model-providers/models", {
      manifest: {
        name: "or",
        baseUrl: "http://host.invalid/v1/",
        apiKey: "k",
        models: [{ name: "b", modelId: "a/b", contextWindow: 1, maxTokens: 1, reasoning: false }],
      },
    });
    expect(listed.json.models).toEqual([{ id: "a/b", contextWindow: 32_000, costKnown: false }]);
  });

  it("answers 502 when a host's /models fails", async () => {
    const fake = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const { call } = await app(fake);
    const listed = await call("POST", "/settings/model-providers/models", {
      manifest: {
        name: "or",
        baseUrl: "http://host.invalid/v1",
        apiKey: "k",
        models: [{ name: "b", modelId: "b", contextWindow: 1, maxTokens: 1, reasoning: false }],
      },
    });
    expect(listed.status).toBe(502);
    expect(listed.json.error).toBe("models: HTTP 401");
  });

  it("reports a test that cannot resolve the model as a failure, not an error", async () => {
    const { call } = await app();
    const result = await call("POST", "/settings/model-providers/test", {
      manifest: anthropic,
      model: "gpt-4",
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ ok: false, error: 'Unknown model "anthropic/gpt-4"' });
  });
});
