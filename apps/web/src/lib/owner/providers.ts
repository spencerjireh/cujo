import type { ProviderModel, ProviderSettings } from "@/lib/api/owner-client";

/**
 * The provider forms on the instance page (decision 174), decided without a
 * component: a provider as the form holds it, and back; the model names the
 * picker offers; and which model a "Test" button asks for.
 */

export type ProviderDraft =
  | { kind: "anthropic"; apiKey: string }
  | {
      kind: "openai";
      name: string;
      baseUrl: string;
      apiKey: string;
      /** `name=provider id, ...`, the way the form has always taken them. */
      models: string;
      contextWindow: string;
      maxTokens: string;
      reasoning: boolean;
    };

/** Haiku: the cheapest catalog model, so a test costs next to nothing. */
const ANTHROPIC_TEST_MODEL = "claude-haiku-4-5";

export function draftOf(provider: ProviderSettings): ProviderDraft {
  if (provider.kind === "anthropic") return { kind: "anthropic", apiKey: provider.apiKey };
  return {
    kind: "openai",
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models: provider.models.map((m) => `${m.name}=${m.modelId}`).join(", "),
    contextWindow: String(provider.contextWindow),
    maxTokens: String(provider.maxTokens),
    reasoning: provider.reasoning,
  };
}

export function emptyDraft(kind: ProviderDraft["kind"]): ProviderDraft {
  if (kind === "anthropic") return { kind, apiKey: "" };
  return {
    kind,
    name: "",
    baseUrl: "",
    apiKey: "",
    models: "",
    contextWindow: "128000",
    maxTokens: "16384",
    reasoning: true,
  };
}

/** The pairs as the server takes them; a bare entry is its own name and id. */
export function parsePairs(text: string): { name: string; modelId: string }[] {
  return text
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1
        ? { name: pair, modelId: pair }
        : { name: pair.slice(0, eq).trim(), modelId: pair.slice(eq + 1).trim() };
    });
}

export function providerOf(draft: ProviderDraft): ProviderSettings {
  if (draft.kind === "anthropic") {
    return { kind: "anthropic", name: "anthropic", apiKey: draft.apiKey };
  }
  return {
    kind: "openai",
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey,
    models: parsePairs(draft.models),
    contextWindow: Number(draft.contextWindow),
    maxTokens: Number(draft.maxTokens),
    reasoning: draft.reasoning,
  };
}

/**
 * Every `<provider>/<model>` the saved providers serve: an OpenAI-compatible
 * host's declared names, and Anthropic's catalog ids once they are listed.
 */
export function modelOptions(
  providers: ProviderSettings[],
  catalog: ProviderModel[] | undefined,
): string[] {
  return providers.flatMap((provider) =>
    provider.kind === "anthropic"
      ? (catalog ?? []).map((model) => `anthropic/${model.id}`)
      : provider.models.map((model) => `${provider.name}/${model.name}`),
  );
}

/** The model a test call asks for, or null when the draft declares none. */
export function testModelOf(draft: ProviderDraft): string | null {
  if (draft.kind === "anthropic") return ANTHROPIC_TEST_MODEL;
  return parsePairs(draft.models)[0]?.name ?? null;
}
