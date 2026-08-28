/**
 * Environment for the apps/cujo process. Every name here is fixed by the build
 * contract; a missing required value fails at start, not on the first webhook.
 */

export interface Config {
  port: number;
  trueforgeBaseUrl: string;
  githubWebhookSecret: string;
  githubAppId: string;
  githubAppPrivateKey: string;
  uiHost: string;
  internalHost: string;
  webhookHost: string;
  /** Public origin of the Cujo UI, used for the run link in a Discord card. */
  uiBaseUrl: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const devNoAccess = env.CUJO_DEV_NO_ACCESS === "1";
  const modelProviderBaseUrl = env.MODEL_PROVIDER_BASE_URL;
  const modelProviderApiKey = env.MODEL_PROVIDER_API_KEY;
  const uiHost = env.CUJO_UI_HOST ?? "cujo.spencerjireh.com";
  return {
    port: Number(env.PORT ?? 8080),
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
