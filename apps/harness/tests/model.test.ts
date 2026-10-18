import { describe, expect, it } from "vitest";
import { Models, escapeConfigValue, providerConfigOf, thinkingLevelOf } from "../src/model";
import { STUB_MODEL, StubModel, manifestOf } from "./stub-model";

describe("escapeConfigValue", () => {
  it("keeps a key pi would otherwise read as a reference literal", () => {
    expect(escapeConfigValue("sk-abc")).toBe("sk-abc");
    expect(escapeConfigValue("$HOME")).toBe("$$HOME");
    expect(escapeConfigValue("!cmd")).toBe("$!cmd");
  });
});

describe("providerConfigOf", () => {
  it("registers every model as openai-completions with the manifest's limits", () => {
    const config = providerConfigOf({
      ...manifestOf(),
      models: [
        {
          name: "m",
          modelId: "m-1",
          contextWindow: 200,
          maxTokens: 50,
          reasoning: true,
          compat: { supportsStore: true },
        },
      ],
    });
    expect(config.api).toBe("openai-completions");
    expect(config.models?.[0]).toMatchObject({
      id: "m-1",
      name: "m",
      reasoning: true,
      contextWindow: 200,
      maxTokens: 50,
      compat: { supportsStore: true },
    });
  });

  it("defaults compat to the conservative shape for an unknown host", () => {
    const config = providerConfigOf(manifestOf());
    expect(config.models?.[0]?.compat).toEqual({
      supportsDeveloperRole: false,
      supportsStore: false,
    });
  });
});

describe("thinkingLevelOf", () => {
  it("maps none to off and passes the rest through", () => {
    expect(thinkingLevelOf(undefined)).toBe("off");
    expect(thinkingLevelOf("none")).toBe("off");
    expect(thinkingLevelOf("xhigh")).toBe("xhigh");
  });
});

describe("Models.resolve", () => {
  it("finds a model by the spec's <provider>/<name> and applies per-session params", async () => {
    const models = await Models.create();
    new StubModel().register(models);
    const model = models.resolve(STUB_MODEL, { temperature: 0, maxTokens: 123 });
    expect(model.id).toBe("stub-1");
    expect(model.maxTokens).toBe(123);
    expect(model.samplingParams).toEqual({ temperature: 0 });
    expect(models.resolve(STUB_MODEL, undefined).maxTokens).toBe(4_000);
  });

  it("names an unknown model", async () => {
    const models = await Models.create();
    expect(() => models.resolve("nope/x", undefined)).toThrow('Unknown model "nope/x"');
  });

  it("registers a real manifest and marks the provider as configured", async () => {
    const models = await Models.create();
    models.register({ ...manifestOf(), name: "real", apiKey: "sk-literal" });
    expect(models.runtime.hasConfiguredAuth("real")).toBe(true);
    expect(models.resolve("real/stub", undefined).baseUrl).toBe("http://stub.invalid");
  });
});

describe("an anthropic provider", () => {
  const anthropic = { kind: "anthropic", name: "anthropic", apiKey: "sk-ant-x" } as const;

  it("registers the key alone, so the built-in catalog stays whole", () => {
    expect(providerConfigOf(anthropic)).toEqual({ name: "anthropic", apiKey: "sk-ant-x" });
  });

  it("resolves a catalog id with its limits and its price", async () => {
    const models = await Models.create();
    models.register(anthropic);
    const model = models.resolve("anthropic/claude-sonnet-5", undefined);
    expect(model.api).toBe("anthropic-messages");
    expect(model.baseUrl).toBe("https://api.anthropic.com");
    expect(model.cost.input).toBeGreaterThan(0);
    expect(models.runtime.hasConfiguredAuth("anthropic")).toBe(true);
  });

  it("builds a Claude id newer than the catalog with adaptive thinking and no price", async () => {
    const models = await Models.create();
    models.register(anthropic);
    const model = models.resolve("anthropic/claude-sonnet-9", undefined);
    expect(model.id).toBe("claude-sonnet-9");
    expect(model.api).toBe("anthropic-messages");
    expect(model.cost.input).toBe(0);
    expect(model.compat).toMatchObject({ forceAdaptiveThinking: true, supportsTemperature: false });
    expect(() => models.resolve("anthropic/gpt-4", undefined)).toThrow("Unknown model");
  });

  it("resolves nothing once unregistered", async () => {
    const models = await Models.create();
    models.register(anthropic);
    models.unregister("anthropic");
    expect(() => models.resolve("anthropic/claude-sonnet-5", undefined)).toThrow("Unknown model");
  });
});
