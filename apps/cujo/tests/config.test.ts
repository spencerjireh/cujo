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

  it("requires the Access values unless dev or a token replaces them", () => {
    const { CF_ACCESS_AUD: _aud, ...withoutAud } = base;
    expect(() => loadConfig(withoutAud)).toThrow("CF_ACCESS_AUD is required");
    const dev = loadConfig({ ...withoutAud, CUJO_DEV_NO_ACCESS: "1" });
    expect(dev.devNoAccess).toBe(true);
    expect(dev.cfAccessAud).toBe("");
    // The other way out, and what makes the two gates orderable: a deploy that
    // has set the token no longer has to keep the Access values around to
    // start (decision 49).
    const tokened = loadConfig({ ...withoutAud, CUJO_OPERATOR_TOKEN: "s3cret" });
    expect(tokened.operatorToken).toBe("s3cret");
    expect(tokened.cfAccessAud).toBe("");
  });

  it("trims the operator token, and treats whitespace as no token", () => {
    // The login form trims what an operator pastes, so a secret normalised on
    // one side only would disable the Access requirement while being
    // impossible to present through the UI.
    expect(loadConfig({ ...base, CUJO_OPERATOR_TOKEN: "  s3cret\n" }).operatorToken).toBe("s3cret");
    const { CF_ACCESS_AUD: _aud, ...withoutAud } = base;
    expect(() => loadConfig({ ...withoutAud, CUJO_OPERATOR_TOKEN: "   " })).toThrow(
      "CF_ACCESS_AUD is required",
    );
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
    // The whole path, not just the basename. `toContain("cujo")` would stay
    // true if the archive moved, so it would have watched the default 404
    // without failing — and nothing in CI fetches this URL.
    expect(config.sniffTarballUrl).toBe(
      "https://codeload.github.com/spencerjireh/cujo/tar.gz/refs/heads/main",
    );
  });

  it("falls back when the tarball URL is empty, and refuses a script URL", () => {
    // The key that replaced CUJO_SNIFF_URL, so the mistake to expect is the old
    // value pasted into the new name. Better a boot failure than a `tar` error
    // inside a sandbox nobody reads the logs of (decision 46).
    expect(loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: "" }).sniffTarballUrl).toBe(
      "https://codeload.github.com/spencerjireh/cujo/tar.gz/refs/heads/main",
    );
    expect(
      loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: "https://x/y.tar.gz" }).sniffTarballUrl,
    ).toBe("https://x/y.tar.gz");
    expect(() =>
      loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: "https://x/sandbox/sniff.py" }),
    ).toThrow(/must be a source archive/);
  });

  it("refuses a tarball URL the rubric's shell would not read as one word", () => {
    // The rubric interpolates this into a double-quoted shell word, where `&`
    // and `;` are safe but these four are not: such a value would change the
    // command the sandbox runs rather than the URL it fetches. A signed URL
    // with an `&` between query parameters stays legal, which is the case that
    // has to keep working.
    const ok = "https://x/archive.tar.gz?token=a&expires=1";
    expect(loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: ok }).sniffTarballUrl).toBe(ok);
    for (const bad of [
      'https://x/a".tar.gz',
      "https://x/a`id`.tar.gz",
      "https://x/$HOME.tar.gz",
      "https://x/a\\b.tar.gz",
      "https://x/a b.tar.gz",
    ]) {
      expect(() => loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: bad }), bad).toThrow(
        /quotes, backslashes/,
      );
    }
    expect(() => loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: "not-a-url" })).toThrow(
      /absolute URL/,
    );
    expect(() => loadConfig({ ...base, CUJO_SNIFF_TARBALL_URL: "file:///etc/passwd" })).toThrow(
      /http or https/,
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
      // Nothing declared unless asked for: this is what every deploy sent
      // before decision 56, and it is why an effort could not be used.
      reasoningEfforts: [],
    });
    expect(config.bootstrap.daytonaApiKey).toBe("d");
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

  it("declares the reasoning efforts the registration will carry", () => {
    const config = loadConfig({
      ...base,
      ...withProvider,
      MODEL_PROVIDER_REASONING_EFFORTS: " none , low ,,medium ",
    });
    expect(config.bootstrap.modelProvider?.reasoningEfforts).toEqual(["none", "low", "medium"]);
  });

  it("refuses to start when the chosen effort is not declared", () => {
    // The whole point of decision 56. Without this the process starts, reports
    // healthy, and answers 502 to every pull request — the failure is invisible
    // except in GitHub's delivery log, which nobody is reading.
    expect(() =>
      loadConfig({
        ...base,
        ...withProvider,
        MODEL_PROVIDER_REASONING_EFFORTS: "none,medium",
        CUJO_MODEL_REASONING_EFFORT: "low",
      }),
    ).toThrow(/"low".*does not declare.*none, medium/s);

    // And when nothing at all is declared, which is the state that shipped.
    expect(() =>
      loadConfig({ ...base, ...withProvider, CUJO_MODEL_REASONING_EFFORT: "low" }),
    ).toThrow(/it is empty/);
  });

  it("accepts a declared effort, and says nothing when none is chosen", () => {
    expect(
      loadConfig({
        ...base,
        ...withProvider,
        MODEL_PROVIDER_REASONING_EFFORTS: "none,low",
        CUJO_MODEL_REASONING_EFFORT: "low",
      }).modelReasoningEffort,
    ).toBe("low");
    expect(loadConfig({ ...base, ...withProvider }).modelReasoningEffort).toBe("");
  });

  it("does not refuse when this process is not the one registering the provider", () => {
    // The provider is configured in the operator console instead, so Cujo has
    // no idea what it declares. Refusing on a guess would block a deploy that
    // works.
    expect(loadConfig({ ...base, CUJO_MODEL_REASONING_EFFORT: "low" }).modelReasoningEffort).toBe(
      "low",
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

    it("lets the visibility sweep be turned off with zero, but not by accident", () => {
      expect(loadConfig(base).visibilityRecheckMs).toBe(15 * 60 * 1000);
      expect(loadConfig({ ...base, CUJO_VISIBILITY_RECHECK_MS: "0" }).visibilityRecheckMs).toBe(0);
      expect(loadConfig({ ...base, CUJO_VISIBILITY_RECHECK_MS: "" }).visibilityRecheckMs).toBe(
        15 * 60 * 1000,
      );
    });
  });
});
