/**
 * The model side of pi: one `ModelRuntime` per process, fed only by the
 * provider manifests Cujo registers at bootstrap. Nothing under `~/.pi` is
 * read or written; the credential store is in memory and there is no
 * models.json.
 *
 * Reasoning effort is clamped by pi against what the model declares, not
 * validated against a list the provider had to announce (decision 127).
 */

import type { ModelParams, ModelProviderManifest, ReasoningEffort } from "@cujo/harness-contract";
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

export function providerConfigOf(manifest: ModelProviderManifest): ProviderConfigInput {
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
    const entry = manifest?.models.find((model) => model.name === modelName);
    if (!manifest || !entry) throw new UnknownModelError(name);
    const base = this.runtime.getModel(providerName, entry.modelId);
    if (!base) throw new UnknownModelError(name);
    return {
      ...base,
      ...(params?.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(params?.temperature !== undefined
        ? { samplingParams: { ...base.samplingParams, temperature: params.temperature } }
        : {}),
    };
  }
}

export class UnknownModelError extends Error {
  constructor(name: string) {
    super(`Unknown model "${name}"`);
    this.name = "UnknownModelError";
  }
}
