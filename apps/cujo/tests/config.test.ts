import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  GITHUB_WEBHOOK_SECRET: "s",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "pem",
  CUJO_MODEL: "p/m",
};

describe("loadConfig", () => {
  /**
   * The three tests that guarded `CUJO_SNIFF_TARBALL_URL` are gone with the
   * variable (decision 117). The sensors ship in the sandbox image now, so there
   * is no URL to validate, no shell word for it to break out of, and no old
   * `CUJO_SNIFF_URL` value to paste into the wrong key.
   */
  it("names the first missing required variable", () => {
    expect(() => loadConfig({})).toThrow("GITHUB_WEBHOOK_SECRET is required");
    const { CUJO_MODEL: _model, ...withoutModel } = base;
    expect(() => loadConfig(withoutModel)).toThrow("CUJO_MODEL is required");
  });

  it("starts with no credential configured, because none exists", () => {
    // Decision 57 deleted the last gate, so the variables that used to be
    // conditionally required are gone. A deploy that still sets them starts
    // exactly the same way — they are read by nothing.
    const stale = loadConfig({
      ...base,
      CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
      CUJO_OPERATOR_TOKEN: "s3cret",
      CUJO_DEV_NO_ACCESS: "1",
    });
    expect(stale).toEqual(loadConfig(base));
  });

  it("applies the compose-network defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      port: 8080,
      harnessBaseUrl: "http://harness:8790",
      internalHost: "cujo",
      webhookHost: "cujo-ingress.spencerjireh.com",
      dbPath: "/data/cujo.db",
      githubMcpUrl: "http://github-mcp:8081/mcp",
      turnTimeoutMs: 30 * 60 * 1000,
      bootstrap: { modelProvider: null },
    });
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

  it("takes the board's origin as given, and defaults it to none", () => {
    // No derivation from a hostname any more: there is one origin, it is the
    // only place a card can link to, and an unset value means no card carries
    // a link at all rather than one pointing somewhere nobody can open.
    expect(loadConfig(base).publicBaseUrl).toBe("");
    expect(loadConfig({ ...base, CUJO_PUBLIC_BASE_URL: "" }).publicBaseUrl).toBe("");
    expect(
      loadConfig({ ...base, CUJO_PUBLIC_BASE_URL: "https://cujo.spencerjireh.com/" }).publicBaseUrl,
    ).toBe("https://cujo.spencerjireh.com");
  });

  it("parses the model provider list and registers it only with a URL and a key", () => {
    const config = loadConfig({
      ...base,
      MODEL_PROVIDER_BASE_URL: "https://llm.example/v1",
      MODEL_PROVIDER_API_KEY: "k",
      MODEL_PROVIDER_MODELS: " fast=vendor/fast-1 , plain ,",
    });
    expect(config.bootstrap.modelProvider).toEqual({
      name: "openrouter",
      baseUrl: "https://llm.example/v1",
      apiKey: "k",
      models: [
        { name: "fast", modelId: "vendor/fast-1" },
        { name: "plain", modelId: "plain" },
      ],
      contextWindow: 128_000,
      maxTokens: 16_384,
      reasoning: true,
    });
    expect(
      loadConfig({ ...base, MODEL_PROVIDER_BASE_URL: "https://llm.example/v1" }).bootstrap
        .modelProvider,
    ).toBeNull();
  });

  const withProvider = {
    MODEL_PROVIDER_BASE_URL: "https://llm.example/v1",
    MODEL_PROVIDER_API_KEY: "k",
    MODEL_PROVIDER_MODELS: "fast=vendor/fast-1",
  };

  it("carries the model's limits and whether it reasons (decision 127)", () => {
    const provider = loadConfig({
      ...base,
      ...withProvider,
      MODEL_PROVIDER_CONTEXT_WINDOW: "200000",
      MODEL_PROVIDER_MAX_TOKENS: "32000",
      MODEL_PROVIDER_REASONING: "0",
    }).bootstrap.modelProvider;
    expect(provider).toMatchObject({ contextWindow: 200_000, maxTokens: 32_000, reasoning: false });
    // Only an explicit "0" turns reasoning off.
    expect(
      loadConfig({ ...base, ...withProvider, MODEL_PROVIDER_REASONING: "" }).bootstrap.modelProvider
        ?.reasoning,
    ).toBe(true);
  });

  it("refuses a value that is not a reasoning effort at all", () => {
    // A bad value would otherwise reach the harness inside the agent spec,
    // which refuses the session after this process reports healthy.
    expect(() => loadConfig({ ...base, CUJO_MODEL_REASONING_EFFORT: "loow" })).toThrow(
      /CUJO_MODEL_REASONING_EFFORT has "loow"/,
    );
  });

  it("accepts an effort, and says nothing when none is chosen", () => {
    expect(
      loadConfig({ ...base, ...withProvider, CUJO_MODEL_REASONING_EFFORT: "low" })
        .modelReasoningEffort,
    ).toBe("low");
    expect(loadConfig({ ...base, ...withProvider }).modelReasoningEffort).toBe("");
    // Nothing has to be declared any more: the harness clamps (decision 127).
    expect(loadConfig({ ...base, CUJO_MODEL_REASONING_EFFORT: "xhigh" }).modelReasoningEffort).toBe(
      "xhigh",
    );
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

    it("sends no sampling key unless a deploy asked for one", () => {
      // The whole point. Every key in `model.params` reaches the provider
      // verbatim, and that is how CUJO_MODEL_REASONING_EFFORT took every review
      // down while /readyz stayed green (decision 56). Unset must mean absent.
      expect(loadConfig(base).modelTemperature).toBeNull();
      expect(loadConfig(base).modelMaxTokens).toBeNull();
      for (const raw of ["", "   "]) {
        expect(loadConfig({ ...base, CUJO_MODEL_TEMPERATURE: raw }).modelTemperature).toBeNull();
      }
    });

    it("keeps a temperature of zero, which is the value somebody wants here", () => {
      expect(loadConfig({ ...base, CUJO_MODEL_TEMPERATURE: "0" }).modelTemperature).toBe(0);
      expect(loadConfig({ ...base, CUJO_MODEL_TEMPERATURE: "0.7" }).modelTemperature).toBe(0.7);
      expect(loadConfig({ ...base, CUJO_MODEL_MAX_TOKENS: "16000" }).modelMaxTokens).toBe(16_000);
    });

    it("refuses a sampling value that is not a number, rather than sending it", () => {
      expect(() => loadConfig({ ...base, CUJO_MODEL_TEMPERATURE: "hot" })).toThrow(
        /CUJO_MODEL_TEMPERATURE/,
      );
      expect(() => loadConfig({ ...base, CUJO_MODEL_MAX_TOKENS: "-1" })).toThrow(
        /non-negative number/,
      );
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
