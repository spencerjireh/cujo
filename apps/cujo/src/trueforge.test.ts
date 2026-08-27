import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { Harness } from "./trueforge";

function harness(steps: {
  mcp?: () => Promise<unknown>;
  provider?: () => Promise<unknown>;
  sandbox?: () => Promise<unknown>;
}) {
  const config = {
    trueforgeBaseUrl: "http://server",
    githubMcpUrl: "http://github-mcp",
    bootstrap: {
      modelProvider: {
        name: "p",
        baseUrl: "http://p",
        apiKey: "k",
        models: [{ name: "m", modelId: "m-1" }],
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

describe("Harness.startTurn", () => {
  it("creates the turn first so its id is known, then subscribes to it", async () => {
    const { h } = harness({});
    const order: string[] = [];
    const sessions = {
      createTurn: vi.fn(async () => {
        order.push("create");
        return { data: { id: "t1" } };
      }),
      subscribeToTurn: vi.fn(async () => {
        order.push("subscribe");
        return (async function* () {})();
      }),
    };
    override(h, "sessions", sessions);
    const started = await h.startTurn("s", "hi");
    expect(started.turnId).toBe("t1");
    expect(order).toEqual(["create", "subscribe"]);
    expect(sessions.subscribeToTurn).toHaveBeenCalledWith("s", "t1", {});
  });
});
