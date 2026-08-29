import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

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
    // The whole path, not just the basename. `toContain("sniff.py")` stayed
    // true when the file moved into sandbox/, so it would have watched the
    // default 404 without failing — and nothing in CI fetches this URL.
    expect(config.sniffUrl).toBe(
      "https://raw.githubusercontent.com/spencerjireh/cujo/main/sandbox/sniff.py",
    );
  });

  it("treats an empty Discord token as no token, which is what compose sends", () => {
    // docker-compose passes an unset optional as `${X:-}`, so the process sees
    // the empty string rather than an absent variable.
    expect(loadConfig(base).discordBotToken).toBeNull();
    expect(loadConfig({ ...base, DISCORD_BOT_TOKEN: "" }).discordBotToken).toBeNull();
    expect(loadConfig({ ...base, DISCORD_BOT_TOKEN: "tok" }).discordBotToken).toBe("tok");
  });

  it("treats the Discord public key the same way, since it gates the commands", () => {
    expect(loadConfig(base).discordPublicKey).toBeNull();
    expect(loadConfig({ ...base, DISCORD_PUBLIC_KEY: "" }).discordPublicKey).toBeNull();
    expect(loadConfig({ ...base, DISCORD_PUBLIC_KEY: "ab12" }).discordPublicKey).toBe("ab12");
  });

  it("treats an empty default guild as none, so compose's `${X:-}` is not a server", () => {
    expect(loadConfig(base).defaultDiscordGuild).toBeNull();
    expect(loadConfig({ ...base, CUJO_DEFAULT_DISCORD_GUILD: "" }).defaultDiscordGuild).toBeNull();
    expect(loadConfig({ ...base, CUJO_DEFAULT_DISCORD_GUILD: "222" }).defaultDiscordGuild).toBe(
      "222",
    );
  });

  it("derives the UI base URL from the UI host, and lets it be overridden", () => {
    expect(loadConfig(base).uiBaseUrl).toBe("https://cujo.spencerjireh.com");
    expect(loadConfig({ ...base, CUJO_UI_BASE_URL: "" }).uiBaseUrl).toBe(
      "https://cujo.spencerjireh.com",
    );
    expect(loadConfig({ ...base, CUJO_UI_BASE_URL: "http://cujo.localhost:8080/" }).uiBaseUrl).toBe(
      "http://cujo.localhost:8080",
    );
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

  /**
   * Compose passes an unset optional as the empty string rather than omitting
   * it, and `Number("")` is 0 — so a cap read with `??` alone would quietly
   * become "no public streams at all" the moment the variable went unset.
   */
  describe("the public plane's numeric settings", () => {
    it("defaults when the variable is unset, empty, or not a whole number", () => {
      for (const raw of [undefined, "", "   ", "abc", "-1", "1.5"]) {
        const env = raw === undefined ? base : { ...base, CUJO_PUBLIC_STREAM_LIMIT: raw };
        expect(loadConfig(env).publicStreamLimit).toBe(200);
      }
    });

    it("takes a configured cap", () => {
      expect(loadConfig({ ...base, CUJO_PUBLIC_STREAM_LIMIT: "50" }).publicStreamLimit).toBe(50);
    });

    it("refuses a cap of zero, which would serve nobody", () => {
      expect(loadConfig({ ...base, CUJO_PUBLIC_STREAM_LIMIT: "0" }).publicStreamLimit).toBe(200);
    });

    it("lets the visibility sweep be turned off with zero, but not by accident", () => {
      expect(loadConfig(base).visibilityRecheckMs).toBe(15 * 60 * 1000);
      expect(loadConfig({ ...base, CUJO_VISIBILITY_RECHECK_MS: "0" }).visibilityRecheckMs).toBe(0);
      expect(loadConfig({ ...base, CUJO_VISIBILITY_RECHECK_MS: "" }).visibilityRecheckMs).toBe(
        15 * 60 * 1000,
      );
    });
  });
});
