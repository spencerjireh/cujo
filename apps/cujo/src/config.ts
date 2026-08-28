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
  uiHost: string;
  internalHost: string;
  webhookHost: string;
  /**
   * Origin of the Access-gated operator UI. Since decision 34 that is
   * `cujo-admin`, not `cujo`: it is where a Discord card sends someone who has
   * to decide, and the read-only board has no buttons.
   */
  uiBaseUrl: string;
  /**
   * Origin of the anonymous board. A card for a public run links here instead,
   * so a repo's channel is not answered with a login page. Empty falls back to
   * `uiBaseUrl`.
   */
  publicBaseUrl: string;
  /** Null turns Discord notifications off; the service runs without them. */
  discordBotToken: string | null;
  /**
   * The Discord application's Ed25519 public key, hex. Null turns the slash
   * commands off; notifications still work without it (Contract 8).
   */
  discordPublicKey: string | null;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
  dbPath: string;
  model: string;
  githubMcpUrl: string;
  sniffUrl: string;
  turnTimeoutMs: number;
  /** Concurrent public run streams this process will hold (decision 34). */
  publicStreamLimit: number;
  /** How often to re-ask GitHub whether each repo with a run is still public. */
  visibilityRecheckMs: number;
  devNoAccess: boolean;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const devNoAccess = env.CUJO_DEV_NO_ACCESS === "1";
  const modelProviderBaseUrl = env.MODEL_PROVIDER_BASE_URL;
  const modelProviderApiKey = env.MODEL_PROVIDER_API_KEY;
  const uiHost = env.CUJO_UI_HOST ?? "cujo.spencerjireh.com";
  return {
    port: Number(env.PORT ?? 8080),
    logLevel: parseLevel(env.CUJO_LOG_LEVEL),
    trueforgeBaseUrl: env.TRUEFORGE_BASE_URL ?? "http://server:8790",
    githubWebhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    githubAppId: required(env, "GITHUB_APP_ID"),
    githubAppPrivateKey: required(env, "GITHUB_APP_PRIVATE_KEY"),
    uiHost,
    internalHost: env.CUJO_INTERNAL_HOST ?? "cujo",
    webhookHost: env.CUJO_WEBHOOK_HOST ?? "cujo-ingress.spencerjireh.com",
    // `||`, not `??`: compose passes an unset optional as `${X:-}`, which is
    // the empty string, and `??` would keep it.
    uiBaseUrl: (env.CUJO_UI_BASE_URL || `https://${uiHost}`).replace(/\/+$/, ""),
    publicBaseUrl: (env.CUJO_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    discordBotToken: env.DISCORD_BOT_TOKEN || null,
    discordPublicKey: env.DISCORD_PUBLIC_KEY || null,
    // The Access check is skipped only in dev, so the values are required otherwise.
    cfAccessTeamDomain: devNoAccess
      ? (env.CF_ACCESS_TEAM_DOMAIN ?? "")
      : required(env, "CF_ACCESS_TEAM_DOMAIN"),
    cfAccessAud: devNoAccess ? (env.CF_ACCESS_AUD ?? "") : required(env, "CF_ACCESS_AUD"),
    dbPath: env.CUJO_DB_PATH ?? "/data/cujo.db",
    model: required(env, "CUJO_MODEL"),
    githubMcpUrl: env.GITHUB_MCP_URL ?? "http://github-mcp:8081/mcp",
    sniffUrl:
      env.CUJO_SNIFF_URL ??
      "https://raw.githubusercontent.com/spencerjireh/cujo/main/sandbox/sniff.py",
    turnTimeoutMs: Number(env.CUJO_TURN_TIMEOUT_MS ?? 30 * 60 * 1000),
    publicStreamLimit: count(env.CUJO_PUBLIC_STREAM_LIMIT, 200),
    // 0 disables the sweep; the webhook still carries a flip in seconds.
    visibilityRecheckMs: count(env.CUJO_VISIBILITY_RECHECK_MS, 15 * 60 * 1000, { zeroOk: true }),
    devNoAccess,
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
