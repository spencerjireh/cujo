/**
 * The model side of pi: one `ModelRuntime` per process, fed only by the
 * provider manifests Cujo registers. Nothing under `~/.pi` is read or
 * written; the credential store is in memory and there is no models.json.
 *
 * Reasoning effort is clamped by pi against what the model declares, not
 * validated against a list the provider had to announce (decision 127).
 *
 * Two kinds of provider (decision 174). An `openai` manifest declares every
 * model it serves. An `anthropic` manifest is a key: it overlays pi's
 * built-in `anthropic` provider, whose catalog carries each Claude model's
 * limits, thinking format and prices, so a run on one reports what it cost.
 */

import type {
  ModelParams,
  ModelProviderManifest,
  OpenAiProviderManifest,
  ProviderModel,
  ProviderTestResult,
  ReasoningEffort,
} from "@cujo/harness-contract";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];

/**
 * pi's config resolver reads a leading `$` as an environment variable and a
 * leading `!` as a shell command. A literal key is a literal key.
 */
export function escapeConfigValue(value: string): string {
  if (value.startsWith("$")) return `$${value}`;
  if (value.startsWith("!")) return `$${value}`;
  return value;
}

const ANTHROPIC = "anthropic";

/**
 * What a Claude model newer than pi's catalog is registered as: the format
 * every current model requires (adaptive thinking, no temperature), limits
 * every current model clears, and no price, so its cost is not reported
 * rather than reported as zero.
 */
const UNCATALOGUED_CLAUDE = {
  contextWindow: 200_000,
  maxTokens: 64_000,
  compat: { forceAdaptiveThinking: true, supportsTemperature: false },
};

export function providerConfigOf(manifest: ModelProviderManifest): ProviderConfigInput {
  // No models: an overlay that names none keeps the built-in catalog whole.
  if (manifest.kind === "anthropic") {
    return { name: ANTHROPIC, apiKey: escapeConfigValue(manifest.apiKey) };
  }
  return {
    name: manifest.name,
    baseUrl: manifest.baseUrl,
    api: "openai-completions",
    apiKey: escapeConfigValue(manifest.apiKey),
    models: manifest.models.map((model) => ({
      id: model.modelId,
      name: model.name,
      reasoning: model.reasoning,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      // Unknown hosts: no `developer` role, no `store` flag. Overridable per
      // model through the manifest for a host that wants them.
      compat: (model.compat ?? { supportsDeveloperRole: false, supportsStore: false }) as never,
    })),
  };
}

export function thinkingLevelOf(effort: ReasoningEffort | undefined): ThinkingLevel {
  if (effort === undefined || effort === "none") return "off";
  return effort;
}

export class Models {
  private constructor(
    readonly runtime: ModelRuntime,
    private readonly manifests = new Map<string, ModelProviderManifest>(),
  ) {}

  static async create(): Promise<Models> {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    return new Models(runtime);
  }

  register(manifest: ModelProviderManifest): void {
    this.manifests.set(manifest.name, manifest);
    this.runtime.registerProvider(manifest.name, providerConfigOf(manifest));
  }

  /** The manifest is the gate `resolve` checks, so a removed provider resolves nothing. */
  unregister(name: string): void {
    if (!this.manifests.delete(name)) return;
    this.runtime.unregisterProvider(name);
  }

  /** Tests register a provider with its own `streamSimple` instead of a URL. */
  registerRaw(name: string, manifest: ModelProviderManifest, config: ProviderConfigInput): void {
    this.manifests.set(name, manifest);
    this.runtime.registerProvider(name, config);
  }

  /**
   * `<provider>/<model name>` from the spec to a pi model carrying the spec's
   * per-session parameters. A clone, because pi resolves auth by
   * `model.provider`, so a copied object is as good as the registered one.
   */
  resolve(name: string, params: ModelParams | undefined): Model<Api> {
    const slash = name.indexOf("/");
    const providerName = name.slice(0, slash);
    const modelName = name.slice(slash + 1);
    const manifest = this.manifests.get(providerName);
    if (!manifest) throw new UnknownModelError(name);
    const base =
      manifest.kind === "anthropic" ? this.claude(modelName) : this.declared(manifest, modelName);
    if (!base) throw new UnknownModelError(name);
    return {
      ...base,
      ...(params?.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(params?.temperature !== undefined
        ? { samplingParams: { ...base.samplingParams, temperature: params.temperature } }
        : {}),
    };
  }

  private declared(manifest: OpenAiProviderManifest, modelName: string): Model<Api> | undefined {
    const entry = manifest.models.find((model) => model.name === modelName);
    return entry ? this.runtime.getModel(manifest.name, entry.modelId) : undefined;
  }

  /**
   * A catalog id, or one newer than the catalog built on a catalog model's
   * shape with `UNCATALOGUED_CLAUDE` over it. Only `claude-` ids: anything
   * else is a typo, and a typo should fail here rather than at Anthropic.
   */
  private claude(id: string): Model<Api> | undefined {
    const known = this.runtime.getModel(ANTHROPIC, id);
    if (known) return known;
    const template = this.runtime.getModels(ANTHROPIC)[0];
    if (!id.startsWith("claude-") || !template) return undefined;
    const { thinkingLevelMap: _, ...shape } = template;
    return {
      ...shape,
      id,
      name: id,
      contextWindow: UNCATALOGUED_CLAUDE.contextWindow,
      maxTokens: UNCATALOGUED_CLAUDE.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { ...template.compat, ...UNCATALOGUED_CLAUDE.compat },
    } as Model<Api>;
  }
}

/**
 * What a provider offers, for the board's picker. The catalog for Anthropic;
 * for an OpenAI-compatible host, its `/models`, with the window where the
 * host says it (OpenRouter does).
 */
export async function listModels(
  manifest: ModelProviderManifest,
  models: Models,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  if (manifest.kind === "anthropic") {
    return models.runtime.getModels(ANTHROPIC).map((model) => ({
      id: model.id,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      costKnown: model.cost.input > 0,
    }));
  }
  const response = await fetchImpl(`${manifest.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${manifest.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ProviderError(`models: HTTP ${response.status}`);
  const body = (await response.json()) as {
    data?: { id?: unknown; context_length?: unknown }[];
  };
  return (body.data ?? []).flatMap((entry) =>
    typeof entry.id === "string" && entry.id
      ? [
          {
            id: entry.id,
            ...(positive(entry.context_length) ? { contextWindow: entry.context_length } : {}),
            costKnown: false,
          },
        ]
      : [],
  );
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * One short call with the manifest the owner is about to save, on a runtime
 * of its own so nothing registered on the live one changes. A bad key, a
 * wrong URL or a model the host does not serve is answered here, not on the
 * next pull request.
 */
export async function probe(
  manifest: ModelProviderManifest,
  model: string,
): Promise<ProviderTestResult> {
  const started = Date.now();
  try {
    const scratch = await Models.create();
    scratch.register(manifest);
    const resolved = scratch.resolve(`${manifest.name}/${model}`, undefined);
    const reply = await scratch.runtime.completeSimple(
      resolved,
      { messages: [{ role: "user", content: "Reply with: ok", timestamp: Date.now() }] },
      { maxTokens: 16, signal: AbortSignal.timeout(30_000) },
    );
    const latencyMs = Date.now() - started;
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      return { ok: false, latencyMs, error: reply.errorMessage ?? reply.stopReason };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: Date.now() - started, error: message };
  }
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export class UnknownModelError extends Error {
  constructor(name: string) {
    super(`Unknown model "${name}"`);
    this.name = "UnknownModelError";
  }
}
