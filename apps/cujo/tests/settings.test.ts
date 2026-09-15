/**
 * The runtime settings (decision 152): seeded once from the environment,
 * read at use, validated like the environment, and announced on change.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { type ModelSettings, Settings, parseSetting, seedFromConfig } from "../src/settings";
import { Store } from "../src/store";

const env = {
  GITHUB_WEBHOOK_SECRET: "s",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "k",
  CUJO_MODEL: "p/m",
  CUJO_DIFF_MODEL: "p/flash",
  CUJO_REVIEW_MODE: "diff",
  MODEL_PROVIDER_NAME: "p",
  MODEL_PROVIDER_BASE_URL: "https://llm.example/v1",
  MODEL_PROVIDER_API_KEY: "key",
  MODEL_PROVIDER_MODELS: "m=vendor/m,flash=vendor/flash",
};

function harness(overrides: Record<string, string> = {}) {
  const store = new Store(":memory:");
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
  const seed = seedFromConfig(loadConfig({ ...env, ...overrides }));
  const now = () => new Date("2026-09-15T12:00:00.000Z");
  return {
    store,
    log,
    seed,
    now,
    lines,
    logged: (e: string) => lines.filter((l) => l.event === e),
  };
}

describe("Settings.open", () => {
  it("seeds every key the store lacks, marked seed, and reads what it holds", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    expect(settings.current()).toEqual(h.seed);
    expect(h.store.settings.all().map((r) => [r.key, r.source])).toEqual(
      [
        "diffBudgetTokens",
        "diffModel",
        "model",
        "modelMaxTokens",
        "modelProvider",
        "modelReasoningEffort",
        "modelTemperature",
        "reviewMode",
      ].map((k) => [k, "seed"]),
    );
    expect(settings.sources().model).toBe("seed");
  });

  it("prefers a stored value to the environment on the next boot", () => {
    const h = harness();
    Settings.open(h.store.settings, h.seed, h.log, h.now).set("model", "p/other");
    // A redeploy with a different environment: the store wins for what it holds.
    const later = harness({ CUJO_MODEL: "p/from-env", CUJO_DIFF_MODEL: "p/flash2" });
    const reopened = Settings.open(h.store.settings, later.seed, h.log, h.now);
    expect(reopened.current().model).toBe("p/other");
    // `diffModel` was seeded on the first boot, so the second boot's env is ignored too.
    expect(reopened.current().diffModel).toBe("p/flash");
    expect(reopened.sources()).toMatchObject({ model: "owner", diffModel: "seed" });
  });

  it("replaces a row that no longer parses with the seed and says so", () => {
    const h = harness();
    h.store.settings.put("reviewMode", JSON.stringify("nonsense"), "owner", "t0");
    h.store.settings.put("modelProvider", "{not json", "owner", "t0");
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    expect(settings.current().reviewMode).toBe("diff");
    expect(settings.current().modelProvider).toEqual(h.seed.modelProvider);
    expect(h.logged("settings.invalid").map((l) => l.reason)).toEqual([
      "reviewMode",
      "modelProvider",
    ]);
    expect(h.store.settings.get("reviewMode")).toMatchObject({ value: '"diff"', source: "seed" });
  });
});

describe("Settings.set", () => {
  it("validates like the environment, writes as owner, and announces", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    const seen: string[] = [];
    settings.onChange((key, current) => seen.push(`${key}=${String(current[key])}`));
    expect(settings.set("reviewMode", "sandbox")).toBe("sandbox");
    expect(settings.set("modelTemperature", "0.2")).toBe(0.2);
    expect(settings.set("modelMaxTokens", null)).toBeNull();
    expect(settings.set("modelReasoningEffort", "high")).toBe("high");
    expect(settings.set("diffBudgetTokens", 100_000)).toBe(100_000);
    expect(seen).toEqual([
      "reviewMode=sandbox",
      "modelTemperature=0.2",
      "modelMaxTokens=null",
      "modelReasoningEffort=high",
      "diffBudgetTokens=100000",
    ]);
    expect(h.store.settings.get("reviewMode")).toMatchObject({
      value: '"sandbox"',
      source: "owner",
    });
    expect(h.logged("settings.changed")).toHaveLength(5);
  });

  it("refuses a bad value and writes nothing", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    const listener = vi.fn();
    settings.onChange(listener);
    expect(() => settings.set("reviewMode", "yolo")).toThrow(/not a review mode/);
    expect(() => settings.set("modelReasoningEffort", "harder")).toThrow(/reasoning effort/);
    expect(() => settings.set("model", "")).toThrow(/model name/);
    expect(() => settings.set("diffBudgetTokens", -1)).toThrow(/positive integer/);
    expect(() => settings.set("modelTemperature", "hot")).toThrow(/non-negative number/);
    expect(() => settings.set("modelProvider", { name: "p" })).toThrow(/modelProvider/);
    expect(listener).not.toHaveBeenCalled();
    expect(settings.current()).toEqual(h.seed);
    expect(h.store.settings.get("reviewMode")).toMatchObject({ source: "seed" });
  });

  it("takes a whole provider and hands it to the listener", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    const seen: ModelSettings["modelProvider"][] = [];
    settings.onChange((_key, current) => seen.push(current.modelProvider));
    const provider = {
      name: "q",
      baseUrl: "https://other.example/v1",
      apiKey: "k2",
      models: [{ name: "m", modelId: "vendor/m2" }],
      contextWindow: 200_000,
      maxTokens: 8_192,
      reasoning: false,
    };
    expect(settings.set("modelProvider", provider)).toEqual(provider);
    expect(seen).toEqual([provider]);
    expect(settings.set("modelProvider", null)).toBeNull();
  });
});

describe("parseSetting", () => {
  it("normalises the shapes the store may hold", () => {
    expect(parseSetting("model", " p/m ")).toBe("p/m");
    expect(parseSetting("modelReasoningEffort", "")).toBe("");
    expect(parseSetting("modelTemperature", "")).toBeNull();
    expect(parseSetting("modelMaxTokens", 4096)).toBe(4096);
  });
});
