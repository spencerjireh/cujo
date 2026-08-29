import { type Level, parseLevel } from "@cujo/log";

/**
 * Environment for the apps/cujo process. Every name here is fixed by the build
 * contract; a missing required value fails at start, not on the first webhook.
 */

export interface Config {
  port: number;
  /**
   * Level for `@cujo/log`. Correct with the variable unset, which is what makes
   * this safe across a deploy: merging is the release and the running container
   * keeps its old environment until the swap (decision 35).
   */
  logLevel: Level;
  trueforgeBaseUrl: string;
  githubWebhookSecret: string;
  githubAppId: string;
  githubAppPrivateKey: string;
  /**
   * The compose service name `apps/web` addresses this process by, and since
   * decision 57 the only name the read plane answers on.
   */
  internalHost: string;
  webhookHost: string;
  /**
   * Origin of the anonymous board — the only origin there is (decision 57).
   * A Discord card for a public run links here; a private run has no page, so
   * its card carries no link. Empty means no card carries one.
   */
  publicBaseUrl: string;
  /** Null turns Discord notifications off; the service runs without them. */
  discordBotToken: string | null;
  /**
   * The Discord application's Ed25519 public key, hex. Null turns the slash
   * commands off; notifications still work without it (Contract 8).
   */
  discordPublicKey: string | null;
  /**
   * The one Discord server a repo that declares nothing belongs to
   * (decision 40). Null keeps Contract 8's original rule, where an undeclared
   * repo is nobody's. It never widens who may watch beyond this single id, so
   * a server that invited the bot on its own is refused exactly as before.
   */
  defaultDiscordGuild: string | null;
  dbPath: string;
  model: string;
  /**
   * How hard the model is asked to think, passed straight through to the
   * provider as `model.params.reasoningEffort`. Empty means "say nothing", so
   * the provider's own default stands — which is the right default, because a
   * model that does not reason at all rejects the key outright.
   */
  modelReasoningEffort: string;
  githubMcpUrl: string;
  /** Superseded by `sniffTarballUrl` and no longer read; deleted once every
   * deployed container fetches the tarball (decision 46). */
  sniffUrl: string;
  /** Where the agent fetches the source archive holding `sandbox/`. */
  sniffTarballUrl: string;
  turnTimeoutMs: number;
  /** Concurrent public run streams this process will hold (decision 34). */
  publicStreamLimit: number;
  /**
   * How many `@cujo-guard` questions one pull request may ask per window, and
   * how long that window is (decision 47). This is the one path where a comment
   * provisions a sandbox, so it is the one that needs a ceiling; `0` turns
   * conversation off entirely, which is why it is `zeroOk`.
   */
  converseLimit: number;
  converseWindowMs: number;
  /** How long one answer may take before the person is told it did not finish. */
  converseTimeoutMs: number;
  /** How often to re-ask GitHub whether each repo with a run is still public. */
  visibilityRecheckMs: number;
  /**
   * Does Cujo react on the pull requests it reviews (decision 38)? On unless
   * `CUJO_PR_REACTIONS=0`. A kill switch, because this is the one thing
   * `apps/cujo` writes to a stranger's repository.
   */
  prReactions: boolean;
  /**
   * The GitHub login the App posts as. Configurable so a dev App with a
   * different name still finds its own reviews (idempotency, stale dismissal).
   */
  botLogin: string;
  bootstrap: {
    modelProvider: {
      name: string;
      baseUrl: string;
      apiKey: string;
      /** `name` is the TrueForge model name; `modelId` is the provider's id. */
      models: { name: string; modelId: string }[];
    } | null;
    daytonaApiKey: string | null;
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * A whole number from the environment, or the default. Compose passes an unset
 * optional as the empty string rather than leaving it out, and `Number("")` is
 * 0, so `??` alone would silently turn "not configured" into a limit of zero.
 * `zeroOk` is for the settings where 0 is a real choice and means "off".
 */
function count(
  raw: string | undefined,
  fallback: number,
  options: { zeroOk?: boolean } = {},
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  if (value === 0 && !options.zeroOk) return fallback;
  return value;
}

/**
 * The sensor archive URL, checked at boot because the sandbox cannot check it.
 *
 * The rubric interpolates this value into a shell command, inside double
 * quotes, so `&` and `;` are safe but `"`, `` ` ``, `$`, `\` and whitespace are
 * not: a value carrying one changes the command the sandbox runs rather than
 * the URL it fetches. No URL needs them. This is operator input rather than
 * anything a pull request can reach, so the risk is a broken fetch and not an
 * injection — but a broken fetch is every check failing to start.
 *
 * `.py` is rejected separately because `CUJO_SNIFF_TARBALL_URL` replaced
 * `CUJO_SNIFF_URL` (decision 46), so the mistake to expect is the old value
 * pasted into the new key. Failing here says so once, on the server; the same
 * value reaching the sandbox fails as a `tar` error inside a box nobody is
 * reading the logs of.
 */
function tarballUrl(raw: string): string {
  const reject = (why: string): never => {
    throw new Error(`CUJO_SNIFF_TARBALL_URL ${why}; got ${JSON.stringify(raw)}`);
  };
  if (raw.endsWith(".py")) reject("must be a source archive, not a script");
  if (/["`$\\]|\s/.test(raw)) reject("must not contain quotes, backslashes, $ or whitespace");
  if (!URL.canParse(raw)) reject("must be an absolute URL");
  const { protocol } = new URL(raw);
  if (protocol !== "https:" && protocol !== "http:") reject("must be http or https");
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const modelProviderBaseUrl = env.MODEL_PROVIDER_BASE_URL;
  const modelProviderApiKey = env.MODEL_PROVIDER_API_KEY;
  return {
    port: Number(env.PORT ?? 8080),
    logLevel: parseLevel(env.CUJO_LOG_LEVEL),
    trueforgeBaseUrl: env.TRUEFORGE_BASE_URL ?? "http://server:8790",
    githubWebhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    githubAppId: required(env, "GITHUB_APP_ID"),
    githubAppPrivateKey: required(env, "GITHUB_APP_PRIVATE_KEY"),
    internalHost: env.CUJO_INTERNAL_HOST ?? "cujo",
    webhookHost: env.CUJO_WEBHOOK_HOST ?? "cujo-ingress.spencerjireh.com",
    // `||`, not `??`: compose passes an unset optional as `${X:-}`, which is
    // the empty string, and `??` would keep it.
    publicBaseUrl: (env.CUJO_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    discordBotToken: env.DISCORD_BOT_TOKEN || null,
    discordPublicKey: env.DISCORD_PUBLIC_KEY || null,
    defaultDiscordGuild: env.CUJO_DEFAULT_DISCORD_GUILD || null,
    dbPath: env.CUJO_DB_PATH ?? "/data/cujo.db",
    model: required(env, "CUJO_MODEL"),
    modelReasoningEffort: (env.CUJO_MODEL_REASONING_EFFORT ?? "").trim(),
    githubMcpUrl: env.GITHUB_MCP_URL ?? "http://github-mcp:8081/mcp",
    sniffUrl:
      env.CUJO_SNIFF_URL ??
      "https://raw.githubusercontent.com/spencerjireh/cujo/main/sandbox/sniff.py",
    // `||`, not `??`: an unset compose optional arrives as the empty string,
    // and an empty URL would reach the sandbox as a `curl` with no argument.
    sniffTarballUrl: tarballUrl(
      env.CUJO_SNIFF_TARBALL_URL ||
        "https://codeload.github.com/spencerjireh/cujo/tar.gz/refs/heads/main",
    ),
    turnTimeoutMs: Number(env.CUJO_TURN_TIMEOUT_MS ?? 30 * 60 * 1000),
    publicStreamLimit: count(env.CUJO_PUBLIC_STREAM_LIMIT, 200),
    converseLimit: count(env.CUJO_CONVERSE_LIMIT, 3, { zeroOk: true }),
    converseWindowMs: count(env.CUJO_CONVERSE_WINDOW_MS, 60 * 60 * 1000),
    converseTimeoutMs: count(env.CUJO_CONVERSE_TIMEOUT_MS, 10 * 60 * 1000),
    // 0 disables the sweep; the webhook still carries a flip in seconds.
    visibilityRecheckMs: count(env.CUJO_VISIBILITY_RECHECK_MS, 15 * 60 * 1000, { zeroOk: true }),
    // Only an explicit "0" turns it off, so an unset or misspelt value keeps
    // the pull request answering rather than going quiet without saying why.
    prReactions: env.CUJO_PR_REACTIONS !== "0",
    botLogin: env.CUJO_BOT_LOGIN || "cujo-guard[bot]",
    bootstrap: {
      modelProvider:
        modelProviderBaseUrl && modelProviderApiKey
          ? {
              name: env.MODEL_PROVIDER_NAME ?? "openrouter",
              baseUrl: modelProviderBaseUrl,
              apiKey: modelProviderApiKey,
              // MODEL_PROVIDER_MODELS: `<name>=<provider model id>,...`.
              models: (env.MODEL_PROVIDER_MODELS ?? "")
                .split(",")
                .map((m) => m.trim())
                .filter(Boolean)
                .map((pair) => {
                  const eq = pair.indexOf("=");
                  if (eq === -1) return { name: pair, modelId: pair };
                  return { name: pair.slice(0, eq).trim(), modelId: pair.slice(eq + 1).trim() };
                }),
            }
          : null,
      daytonaApiKey: env.DAYTONA_API_KEY ?? null,
    },
  };
}
