import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = {
  GITHUB_WEBHOOK_SECRET: "s",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "pem",
  CUJO_MODEL: "p/m",
  CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud",
};

describe("loadConfig", () => {
  it("names the first missing required variable", () => {
    expect(() => loadConfig({})).toThrow("GITHUB_WEBHOOK_SECRET is required");
    const { CUJO_MODEL: _model, ...withoutModel } = base;
    expect(() => loadConfig(withoutModel)).toThrow("CUJO_MODEL is required");
  });

  it("requires the Access values unless CUJO_DEV_NO_ACCESS=1", () => {
    const { CF_ACCESS_AUD: _aud, ...withoutAud } = base;
    expect(() => loadConfig(withoutAud)).toThrow("CF_ACCESS_AUD is required");
    const dev = loadConfig({ ...withoutAud, CUJO_DEV_NO_ACCESS: "1" });
    expect(dev.devNoAccess).toBe(true);
    expect(dev.cfAccessAud).toBe("");
  });

  it("applies the compose-network defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      port: 8080,
      trueforgeBaseUrl: "http://server:8790",
      uiHost: "cujo.spencerjireh.com",
      webhookHost: "cujo-ingress.spencerjireh.com",
      dbPath: "/data/cujo.db",
      githubMcpUrl: "http://github-mcp:8081/mcp",
      turnTimeoutMs: 30 * 60 * 1000,
      devNoAccess: false,
      bootstrap: { modelProvider: null, daytonaApiKey: null },
    });
    expect(config.sniffUrl).toContain("sniff.py");
  });

  it("parses the model provider list and registers it only with a URL and a key", () => {
    const config = loadConfig({
      ...base,
      MODEL_PROVIDER_BASE_URL: "https://llm.example/v1",
      MODEL_PROVIDER_API_KEY: "k",
      MODEL_PROVIDER_MODELS: " fast=vendor/fast-1 , plain ,",
      DAYTONA_API_KEY: "d",
    });
    expect(config.bootstrap.modelProvider).toEqual({
      name: "openrouter",
      baseUrl: "https://llm.example/v1",
      apiKey: "k",
      models: [
        { name: "fast", modelId: "vendor/fast-1" },
        { name: "plain", modelId: "plain" },
      ],
    });
    expect(config.bootstrap.daytonaApiKey).toBe("d");
    expect(
      loadConfig({ ...base, MODEL_PROVIDER_BASE_URL: "https://llm.example/v1" }).bootstrap
        .modelProvider,
    ).toBeNull();
  });
});
