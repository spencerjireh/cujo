import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  GITHUB_WEBHOOK_SECRET: "s",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "pem",
  CUJO_MODEL: "p/m",
};

describe("loadConfig", () => {
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
      trueforgeBaseUrl: "http://server:8790",
      internalHost: "cujo",
      webhookHost: "cujo-ingress.spencerjireh.com",
      dbPath: "/data/cujo.db",
      githubMcpUrl: "http://github-mcp:8081/mcp",
      turnTimeoutMs: 30 * 60 * 1000,
      bootstrap: { modelProvider: null, daytonaApiKey: null },
    });
    // The whole path, not just the basename. `toContain("sniff.py")` stayed
    // true when the file moved into sandbox/, so it would have watched the
    // default 404 without failing — and nothing in CI fetches this URL.
    expect(config.sniffUrl).toBe(
      "https://raw.githubusercontent.com/spencerjireh/cujo/main/sandbox/sniff.py",
    );
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
