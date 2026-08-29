import { describe, expect, it, vi } from "vitest";
import { Harness, sandboxAutoStopMinutes } from "../../src/clients/trueforge";
import type { Config } from "../../src/config";

function harness(
  steps: {
    mcp?: () => Promise<unknown>;
    provider?: () => Promise<unknown>;
    sandbox?: () => Promise<unknown>;
  },
  reasoningEfforts: string[] = [],
) {
  const config = {
    trueforgeBaseUrl: "http://server",
    githubMcpUrl: "http://github-mcp",
    turnTimeoutMs: 30 * 60 * 1000,
    bootstrap: {
      modelProvider: {
        name: "p",
        baseUrl: "http://p",
        apiKey: "k",
        models: [{ name: "m", modelId: "m-1" }],
        reasoningEfforts,
      },
      daytonaApiKey: "d",
    },
  } as unknown as Config;
  const h = new Harness(config);
  const ok = async () => ({});
  const settings = {
    mcpServers: { createOrUpdate: vi.fn(steps.mcp ?? ok) },
    modelProviders: { createOrUpdate: vi.fn(steps.provider ?? ok) },
    sandboxProviders: { createOrUpdate: vi.fn(steps.sandbox ?? ok) },
  };
  override(h, "settings", settings);
  return { h, settings };
}

/** The SDK exposes its sub-clients as getters; shadow one on the instance. */
function override(h: Harness, key: "settings" | "sessions", value: unknown): void {
  Object.defineProperty(h.client, key, { value, configurable: true });
}

describe("Harness.bootstrap", () => {
  it("is ready only after every registration, and names the failed step", async () => {
    const { h } = harness({
      provider: async () => {
        throw new Error("502");
      },
    });
    await expect(h.bootstrap()).rejects.toThrow("bootstrap step model-provider p failed");
    expect(h.ready).toBe(false);
  });

  it("retries a failure after github-mcp until the whole bootstrap succeeds", async () => {
    let calls = 0;
    const { h, settings } = harness({
      sandbox: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return {};
      },
    });
    const sleep = vi.fn(async () => {});
    await h.bootstrapUntilReady(sleep);
    expect(h.ready).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(settings.mcpServers.createOrUpdate).toHaveBeenCalledTimes(2);
    expect(settings.sandboxProviders.createOrUpdate).toHaveBeenCalledTimes(2);
  });
});

describe("model provider registration", () => {
  it("declares the reasoning efforts each model accepts", async () => {
    // `properties: {}` told the server the model supports no effort at all, so
    // a session naming one was refused and every review 502'd at the webhook
    // while this process still reported healthy (decision 56).
    const { h, settings } = harness({}, ["none", "low"]);
    await h.bootstrap();
    expect(settings.modelProviders.createOrUpdate).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        type: "custom",
        models: [{ name: "m", modelId: "m-1", properties: { reasoningEfforts: ["none", "low"] } }],
      }),
    });
  });

  it("declares nothing when nothing is configured", async () => {
    // The pre-decision-56 shape, kept: a deploy that does not use this sends
    // exactly what it sent before. `properties` is required, so it stays `{}`
    // rather than being dropped.
    const { h, settings } = harness({});
    await h.bootstrap();
    expect(settings.modelProviders.createOrUpdate).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        models: [{ name: "m", modelId: "m-1", properties: {} }],
      }),
    });
  });
});

describe("sandbox lifetime", () => {
  it("stops an idle sandbox only after a whole turn could have run", async () => {
    expect(sandboxAutoStopMinutes(30 * 60 * 1000)).toBe(45);
    expect(sandboxAutoStopMinutes(90_000)).toBe(17);
    const { h, settings } = harness({});
    await h.bootstrap();
    expect(settings.sandboxProviders.createOrUpdate).toHaveBeenCalledWith({
      manifest: expect.objectContaining({ type: "daytona", autoStopIntervalInMinutes: 45 }),
    });
  });
});

describe("Harness turns", () => {
  it("creates a turn without subscribing, and subscribes on request", async () => {
    const { h } = harness({});
    const sessions = {
      createTurn: vi.fn(async () => ({ data: { id: "t1" } })),
      subscribeToTurn: vi.fn(async () => (async function* () {})()),
      cancel: vi.fn(async () => ({})),
    };
    override(h, "sessions", sessions);
    expect(await h.startTurn("s", "hi")).toBe("t1");
    expect(sessions.createTurn).toHaveBeenCalledWith("s", {
      input: [{ type: "user.message", content: "hi" }],
    });
    expect(sessions.subscribeToTurn).not.toHaveBeenCalled();
    await h.subscribe("s", "t1");
    expect(sessions.subscribeToTurn).toHaveBeenCalledWith("s", "t1", {});
    await h.cancelTurn("s");
    expect(sessions.cancel).toHaveBeenCalledWith("s", {});
  });
});
