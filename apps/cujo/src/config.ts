import { REASONING_EFFORTS, type ReasoningEffort } from "@cujo/harness-contract";
import { type Level, parseLevel } from "@cujo/log";
import { REVIEW_MODES, type ReviewMode } from "./review/types";

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
  harnessBaseUrl: string;
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
  /**
   * The GitHub App's own OAuth client, for the board's sign-in (decision
   * 153). Both or neither: with either missing the owner plane is not served
   * and the internal host answers 404 there, as it did before the plane.
   */
  githubOauthClientId: string | null;
  githubOauthClientSecret: string | null;
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
  /**
   * Sampling, when a deploy asks for it. `null` means the key is not sent, and
   * that is the default: see `sampling()` for why "unset" cannot mean "a
   * sensible value". Pinning `modelTemperature` is what makes two runs of the
   * same head comparable; `modelMaxTokens` is the cap that decides whether a
   * sub-agent's report gets cut off mid-JSON, which the fold now reports as
   * `finish_reason: length` rather than as a missing check.
   */
  modelTemperature: number | null;
  modelMaxTokens: number | null;
  githubMcpUrl: string;
  /** Where the agent reaches its sandbox, since the harness no longer has one. */
  sandboxMcpUrl: string;
  turnTimeoutMs: number;
  /**
   * The review a pull request gets when its repository declares none
   * (decision 135): `sandbox` until an operator says otherwise, so an
   * existing deploy reviews exactly as it did. A repository's `.cujo.yml`
   * overrides it; the two floors override both.
   */
  reviewMode: ReviewMode;
  /**
   * The diff review's model, `CUJO_DIFF_MODEL`, falling back to `model`. Its
   * own setting because the diff review is the cheap path by design (decision
   * 133), and the model that reads a diff need not be the one that runs a
   * sandbox. When it differs from `model`, no sampling params are sent with it:
   * the three above were tuned for the other model.
   */
  diffModel: string;
  /** `config.tokenBudget` on the diff spec (decision 132): billed tokens per run. */
  diffBudgetTokens: number;
  /** How long a diff review may take; it reads, so far less than a sandbox run. */
  diffTimeoutMs: number;
  /** Bytes of patch text the diff review is handed (Contract 11). */
  diffBytes: number;
  /**
   * Where the `ocr-sidecar` service answers, `CUJO_OCR_SIDECAR_URL`, or null
   * for no shadow review at all (decision 149). Optional the way Discord is:
   * unset, and no run asks.
   */
  ocrSidecarUrl: string | null;
  /** How long one shadow review may take, clone included. */
  ocrTimeoutMs: number;
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
  /** How often to re-list the App's installations into the registry (decision 151). */
  registrySyncMs: number;
  /**
   * Does Cujo react on the pull requests it reviews (decision 38)? On unless
   * `CUJO_PR_REACTIONS=0`. A kill switch, because this is the one thing
   * `apps/cujo` writes to a stranger's repository.
   */
  prReactions: boolean;
  /**
   * Does Cujo write the `cujo/guard` check run on the commits it reviews
   * (decision 138)? On unless `CUJO_PR_CHECKS=0`. A kill switch for the same
   * reason as the reaction's, and for one more: the write needs `checks:
   * write`, which an installation may not have re-approved yet, and a deploy
   * can quiet the 403s until it has.
   */
  prChecks: boolean;
  /**
   * How long a `synchronize` waits before its run starts, so a burst of
   * pushes is one run on the last head (decision 144). `0` starts every push
   * at once.
   */
  pushDebounceMs: number;
  /**
   * The GitHub login the App posts as. Configurable so a dev App with a
   * different name still finds its own reviews (idempotency, stale dismissal).
   */
  botLogin: string;
  bootstrap: {
    modelProvider: ModelProviderConfig | null;
  };
}

/** The provider `apps/cujo` registers on the harness (decision 127). */
export interface ModelProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** `name` is what `CUJO_MODEL` names after the slash; `modelId` is the provider's id. */
  models: { name: string; modelId: string }[];
  /**
   * What the harness needs to know about every one of these models
   * (decision 127): the window it clamps the output cap against, that cap,
   * and whether a reasoning effort means anything to it at all. One value
   * each for every model in the list, because a deploy registers one
   * provider and, in practice, one model.
   */
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

/**
 * The efforts the harness contract names, taken from the package rather than
 * retyped, so the list cannot drift from the schema that validates the spec.
 *
 * Checked here and not at session creation: an unknown value is accepted by
 * every string type between here and the wire, and a spec the harness refuses
 * is a webhook answering 502 while this process reports healthy. Failing here
 * is a container that visibly will not boot.
 */
const EFFORTS: readonly string[] = REASONING_EFFORTS;

export function effort(raw: string, name: string): ReasoningEffort {
  if (!EFFORTS.includes(raw)) {
    throw new Error(
      `${name} has ${JSON.stringify(raw)}, which is not a reasoning effort. Valid values: ${EFFORTS.join(", ")}.`,
    );
  }
  return raw as ReasoningEffort;
}

/**
 * A sampling parameter, or `null` for "do not send this key at all".
 *
 * The null matters more than the number. Every key in `model.params` is
 * forwarded to the provider verbatim, and that is precisely how
 * `CUJO_MODEL_REASONING_EFFORT` took every review down: the process booted,
 * `/readyz` stayed green, and each webhook answered 502 (decision 56). Some
 * reasoning models reject `temperature` outright or accept only `1`, so a
 * hard-pinned value here would be the same outage with a different key.
 *
 * Unset therefore means absent rather than a default, so a deploy that sets
 * neither of these sends the request it sent before they existed. An operator
 * turns each on once they know their provider takes it.
 */
export function sampling(raw: string | undefined, name: string): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} has ${JSON.stringify(raw)}, which is not a non-negative number.`);
  }
  return value;
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
 * `CUJO_REVIEW_MODE`, checked at boot for the reason `effort` is: a mode the
 * code does not know would otherwise reach `resolveMode` as a string and be
 * stamped on every run. Unset is `sandbox`.
 */
export function mode(raw: string | undefined): ReviewMode {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "sandbox";
  if (!(REVIEW_MODES as readonly string[]).includes(trimmed)) {
    throw new Error(
      `CUJO_REVIEW_MODE has ${JSON.stringify(raw)}, which is not a review mode. Valid values: ${REVIEW_MODES.join(", ")}.`,
    );
  }
  return trimmed as ReviewMode;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const modelProviderBaseUrl = env.MODEL_PROVIDER_BASE_URL;
  const modelProviderApiKey = env.MODEL_PROVIDER_API_KEY;
  const chosen = (env.CUJO_MODEL_REASONING_EFFORT ?? "").trim();
  // The seven words the harness clamps against what the model declares
  // (decision 127); nothing has to be announced to the provider any more.
  const modelReasoningEffort = chosen ? effort(chosen, "CUJO_MODEL_REASONING_EFFORT") : "";
  return {
    port: Number(env.PORT ?? 8080),
    logLevel: parseLevel(env.CUJO_LOG_LEVEL),
    harnessBaseUrl: env.HARNESS_BASE_URL ?? "http://harness:8790",
    githubWebhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    githubAppId: required(env, "GITHUB_APP_ID"),
    githubAppPrivateKey: required(env, "GITHUB_APP_PRIVATE_KEY"),
    internalHost: env.CUJO_INTERNAL_HOST ?? "cujo",
    webhookHost: env.CUJO_WEBHOOK_HOST ?? "cujo-ingress.spencerjireh.com",
    // `||`, not `??`: compose passes an unset optional as `${X:-}`, which is
    // the empty string, and `??` would keep it.
    publicBaseUrl: (env.CUJO_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    githubOauthClientId: env.GITHUB_OAUTH_CLIENT_ID || null,
    githubOauthClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET || null,
    discordBotToken: env.DISCORD_BOT_TOKEN || null,
    discordPublicKey: env.DISCORD_PUBLIC_KEY || null,
    defaultDiscordGuild: env.CUJO_DEFAULT_DISCORD_GUILD || null,
    dbPath: env.CUJO_DB_PATH ?? "/data/cujo.db",
    model: required(env, "CUJO_MODEL"),
    modelReasoningEffort,
    modelTemperature: sampling(env.CUJO_MODEL_TEMPERATURE, "CUJO_MODEL_TEMPERATURE"),
    modelMaxTokens: sampling(env.CUJO_MODEL_MAX_TOKENS, "CUJO_MODEL_MAX_TOKENS"),
    githubMcpUrl: env.GITHUB_MCP_URL ?? "http://github-mcp:8081/mcp",
    sandboxMcpUrl: env.SANDBOX_MCP_URL ?? "http://sandbox-mcp:8082/mcp",
    // `||`, not `??`: an unset compose optional arrives as the empty string,
    // and an empty URL would reach the sandbox as a `curl` with no argument.
    turnTimeoutMs: Number(env.CUJO_TURN_TIMEOUT_MS ?? 30 * 60 * 1000),
    reviewMode: mode(env.CUJO_REVIEW_MODE),
    // `||`: the compose optional arrives empty, and an empty model name is
    // not a model.
    diffModel: env.CUJO_DIFF_MODEL || required(env, "CUJO_MODEL"),
    diffBudgetTokens: count(env.CUJO_DIFF_BUDGET_TOKENS, 400_000),
    diffTimeoutMs: count(env.CUJO_DIFF_TIMEOUT_MS, 10 * 60 * 1000),
    diffBytes: count(env.CUJO_DIFF_BYTES, 60_000),
    // `||`: the compose optional arrives empty, and an empty URL is not a
    // sidecar.
    ocrSidecarUrl: env.CUJO_OCR_SIDECAR_URL || null,
    ocrTimeoutMs: count(env.CUJO_OCR_TIMEOUT_MS, 21 * 60 * 1000),
    publicStreamLimit: count(env.CUJO_PUBLIC_STREAM_LIMIT, 200),
    converseLimit: count(env.CUJO_CONVERSE_LIMIT, 3, { zeroOk: true }),
    converseWindowMs: count(env.CUJO_CONVERSE_WINDOW_MS, 60 * 60 * 1000),
    converseTimeoutMs: count(env.CUJO_CONVERSE_TIMEOUT_MS, 10 * 60 * 1000),
    // 0 disables the sweep; the webhook still carries a flip in seconds.
    visibilityRecheckMs: count(env.CUJO_VISIBILITY_RECHECK_MS, 15 * 60 * 1000, { zeroOk: true }),
    registrySyncMs: count(env.CUJO_REGISTRY_SYNC_MS, 6 * 60 * 60 * 1000, { zeroOk: true }),
    // Only an explicit "0" turns it off, so an unset or misspelt value keeps
    // the pull request answering rather than going quiet without saying why.
    prReactions: env.CUJO_PR_REACTIONS !== "0",
    prChecks: env.CUJO_PR_CHECKS !== "0",
    pushDebounceMs: count(env.CUJO_PUSH_DEBOUNCE_MS, 60_000, { zeroOk: true }),
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
              contextWindow: count(env.MODEL_PROVIDER_CONTEXT_WINDOW, 128_000),
              maxTokens: count(env.MODEL_PROVIDER_MAX_TOKENS, 16_384),
              // Only an explicit "0" turns it off: a model that reasons and is
              // told it does not gets no effort at all.
              reasoning: env.MODEL_PROVIDER_REASONING !== "0",
            }
          : null,
    },
  };
}
