/**
 * The runtime settings (decision 152): seeded once from the environment,
 * read at use, validated like the environment, and announced on change.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import {
  type ModelSettings,
  Settings,
  parseSetting,
  ready,
  seedFromConfig,
  unresolvable,
} from "../src/settings";
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
        "converseLimit",
        "converseTimeoutMs",
        "converseWindowMs",
        "diffBudgetTokens",
        "diffBytes",
        "diffModel",
        "diffTimeoutMs",
        "executeDeclared",
        "executeStepTimeoutMs",
        "executedReportBytes",
        "model",
        "modelMaxTokens",
        "modelProviders",
        "modelReasoningEffort",
        "modelTemperature",
        "ocrEnabled",
        "pushDebounceMs",
        "reviewMode",
        "sandboxBudgetTokens",
        "turnTimeoutMs",
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
    h.store.settings.put("modelProviders", "{not json", "owner", "t0");
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    expect(settings.current().reviewMode).toBe("diff");
    expect(settings.current().modelProviders).toEqual(h.seed.modelProviders);
    expect(h.logged("settings.invalid").map((l) => l.reason)).toEqual([
      "reviewMode",
      "modelProviders",
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
    expect(() => settings.set("model", "no-slash")).toThrow(/<provider>\/<model>/);
    expect(() => settings.set("diffBudgetTokens", -1)).toThrow(/positive integer/);
    expect(() => settings.set("modelTemperature", "hot")).toThrow(/non-negative number/);
    expect(() => settings.set("modelProviders", [{ name: "p" }])).toThrow(/modelProviders/);
    expect(() =>
      settings.set("modelProviders", [
        { kind: "anthropic", name: "anthropic", apiKey: "a" },
        { kind: "anthropic", name: "anthropic", apiKey: "b" },
      ]),
    ).toThrow(/two providers are named anthropic/);
    expect(listener).not.toHaveBeenCalled();
    expect(settings.current()).toEqual(h.seed);
    expect(h.store.settings.get("reviewMode")).toMatchObject({ source: "seed" });
  });

  it("takes the whole provider list and hands it to the listener", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    const seen: ModelSettings["modelProviders"][] = [];
    settings.onChange((_key, current) => seen.push(current.modelProviders));
    const providers = [
      {
        kind: "openai",
        name: "q",
        baseUrl: "https://other.example/v1",
        apiKey: "k2",
        models: [{ name: "m", modelId: "vendor/m2" }],
        contextWindow: 200_000,
        maxTokens: 8_192,
        reasoning: false,
      },
      { kind: "anthropic", name: "anthropic", apiKey: "sk-ant" },
    ];
    expect(settings.set("modelProviders", providers)).toEqual(providers);
    expect(seen).toEqual([providers]);
    expect(settings.set("modelProviders", [])).toEqual([]);
    expect(settings.set("model", null)).toBeNull();
  });
});

describe("the single provider row (decision 174)", () => {
  it("becomes a one-entry list that keeps its source", () => {
    const h = harness();
    const old = {
      name: "q",
      baseUrl: "https://other.example/v1",
      apiKey: "k2",
      models: [{ name: "m", modelId: "vendor/m2" }],
      contextWindow: 200_000,
      maxTokens: 8_192,
      reasoning: false,
    };
    h.store.settings.put("modelProvider", JSON.stringify(old), "owner", "t0");
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    expect(settings.current().modelProviders).toEqual([{ kind: "openai", ...old }]);
    expect(settings.sources().modelProviders).toBe("owner");
    expect(h.store.settings.get("modelProvider")).toBeNull();
    expect(h.logged("settings.migrated")).toHaveLength(1);
  });

  it("becomes an empty list when it held none", () => {
    const h = harness();
    h.store.settings.put("modelProvider", "null", "seed", "t0");
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    expect(settings.current().modelProviders).toEqual([]);
  });
});

describe("ready and unresolvable (decision 174)", () => {
  it("is null with no model, or with one whose provider is gone", () => {
    const h = harness();
    expect(ready({ ...h.seed, model: null })).toBeNull();
    expect(ready({ ...h.seed, modelProviders: [] })).toBeNull();
    expect(ready({ ...h.seed, diffModel: "gone/x" })).toBeNull();
  });

  it("resolves the diff model to the review model when it has none", () => {
    const h = harness();
    expect(ready({ ...h.seed, diffModel: null })).toMatchObject({ model: "p/m", diffModel: "p/m" });
  });

  it("names the key whose provider is not in the list", () => {
    const h = harness();
    expect(unresolvable(h.seed)).toBeNull();
    expect(
      unresolvable({ ...h.seed, model: null, diffModel: null, modelProviders: [] }),
    ).toBeNull();
    expect(unresolvable({ ...h.seed, diffModel: "x/y" })).toBe(
      "diffModel names provider x, which is not configured",
    );
  });
});

describe("Settings.current", () => {
  it("hands out a copy a consumer cannot edit into the next registration", () => {
    const h = harness();
    const settings = Settings.open(h.store.settings, h.seed, h.log, h.now);
    const held = settings.current();
    const [first] = held.modelProviders;
    if (first?.kind === "openai") first.models.push({ name: "rogue", modelId: "x" });
    if (first) first.apiKey = "leaked";
    expect(settings.current().modelProviders).toEqual(h.seed.modelProviders);
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

describe("the limits and switches (decision 164)", () => {
  it("reads whole numbers, as text or as numbers, and refuses what is not one", () => {
    expect(parseSetting("turnTimeoutMs", 900000)).toBe(900000);
    expect(parseSetting("diffBytes", "120000")).toBe(120000);
    expect(() => parseSetting("turnTimeoutMs", 0)).toThrow("above zero");
    expect(() => parseSetting("diffTimeoutMs", -1)).toThrow("whole number");
    expect(() => parseSetting("converseWindowMs", "soon")).toThrow("whole number");
    expect(() => parseSetting("diffBytes", 1.5)).toThrow("whole number");
  });

  it("lets the two switches that mean off be zero", () => {
    expect(parseSetting("pushDebounceMs", 0)).toBe(0);
    expect(parseSetting("converseLimit", "0")).toBe(0);
  });

  it("takes the sidecar switch as a boolean only", () => {
    expect(parseSetting("ocrEnabled", false)).toBe(false);
    expect(() => parseSetting("ocrEnabled", "yes")).toThrow("true or false");
  });

  it("seeds the sidecar switch from whether a sidecar is configured", () => {
    const h = harness();
    expect(h.seed.ocrEnabled).toBe(false);
  });
});
