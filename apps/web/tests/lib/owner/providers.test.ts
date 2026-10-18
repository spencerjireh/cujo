import type { ProviderSettings } from "@/lib/api/owner-client";
import {
  draftOf,
  emptyDraft,
  modelOptions,
  parsePairs,
  providerOf,
  testModelOf,
} from "@/lib/owner/providers";
import { describe, expect, it } from "vitest";

const openrouter: ProviderSettings = {
  kind: "openai",
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "****1234",
  models: [
    { name: "glm", modelId: "z-ai/glm-5.3-flash" },
    { name: "plain", modelId: "plain" },
  ],
  contextWindow: 128_000,
  maxTokens: 16_384,
  reasoning: true,
};
const anthropic: ProviderSettings = { kind: "anthropic", name: "anthropic", apiKey: "****9f2a" };

describe("the provider forms (decision 174)", () => {
  it("round-trips a provider through the form unchanged", () => {
    expect(providerOf(draftOf(openrouter))).toEqual(openrouter);
    expect(providerOf(draftOf(anthropic))).toEqual(anthropic);
  });

  it("reads a bare pair as its own name and id, and skips empty ones", () => {
    expect(parsePairs(" a=b/c , d ,, ")).toEqual([
      { name: "a", modelId: "b/c" },
      { name: "d", modelId: "d" },
    ]);
  });

  it("offers declared names and the listed catalog, prefixed by provider", () => {
    expect(modelOptions([openrouter, anthropic], undefined)).toEqual([
      "openrouter/glm",
      "openrouter/plain",
    ]);
    expect(modelOptions([anthropic], [{ id: "claude-sonnet-5", costKnown: true }])).toEqual([
      "anthropic/claude-sonnet-5",
    ]);
  });

  it("tests the cheapest catalog model, or a host's first declared one", () => {
    expect(testModelOf(draftOf(anthropic))).toBe("claude-haiku-4-5");
    expect(testModelOf(draftOf(openrouter))).toBe("glm");
    expect(testModelOf(emptyDraft("openai"))).toBeNull();
  });
});
