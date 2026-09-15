/**
 * The settings an owner changes at runtime (decision 152): the models the
 * three reviews run on, their sampling, the diff review's budget, the review
 * mode default, and the model provider itself. Held in the store, seeded once
 * from the environment on the first boot that knows each key, and read at
 * use — a session built after a change is built on the new value, a run
 * claimed after it is stamped with the new model, and a provider change is
 * registered on the harness the moment it is written.
 *
 * `Config` still parses the environment for these keys, because the
 * environment is the seed and because every validator lives there. What
 * changed is who is asked: nothing reads `config.model` after boot; it reads
 * `settings.current().model`.
 */

import { type Logger, errorFields } from "@cujo/log";
import { z } from "zod";
import { type Config, type ModelProviderConfig, effort, mode, sampling } from "./config";
import type { ReviewMode } from "./review/types";
import type { SettingsStore } from "./store/settings";

/** The fields consumers read; the same names as `Config`, so a `Pick` of either fits. */
export interface ModelSettings {
  model: string;
  modelReasoningEffort: Config["modelReasoningEffort"];
  modelTemperature: number | null;
  modelMaxTokens: number | null;
  diffModel: string;
  diffBudgetTokens: number;
  reviewMode: ReviewMode;
  modelProvider: ModelProviderConfig | null;
}

export type SettingKey = keyof ModelSettings;

const SETTING_KEYS: readonly SettingKey[] = [
  "model",
  "modelReasoningEffort",
  "modelTemperature",
  "modelMaxTokens",
  "diffModel",
  "diffBudgetTokens",
  "reviewMode",
  "modelProvider",
];

const ProviderSchema = z
  .object({
    name: z.string().min(1),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    models: z.array(z.object({ name: z.string().min(1), modelId: z.string().min(1) })).min(1),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    reasoning: z.boolean(),
  })
  .strict();

/**
 * One value, checked the way `loadConfig` checks the environment. Throws with
 * the same message a bad environment variable would, so an owner's mistake
 * reads like an operator's.
 */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): ModelSettings[K] {
  switch (key) {
    case "model":
    case "diffModel": {
      if (typeof raw !== "string" || raw.trim() === "")
        throw new Error(`${key} must be a model name`);
      return raw.trim() as ModelSettings[K];
    }
    case "modelReasoningEffort": {
      if (typeof raw !== "string") throw new Error("modelReasoningEffort must be a string");
      return (raw.trim() ? effort(raw.trim(), "modelReasoningEffort") : "") as ModelSettings[K];
    }
    case "modelTemperature":
    case "modelMaxTokens": {
      if (raw === null || raw === undefined || raw === "") return null as ModelSettings[K];
      return sampling(String(raw), key) as ModelSettings[K];
    }
    case "diffBudgetTokens": {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
        throw new Error("diffBudgetTokens must be a positive integer");
      }
      return raw as ModelSettings[K];
    }
    case "reviewMode":
      return mode(typeof raw === "string" ? raw : undefined) as ModelSettings[K];
    case "modelProvider": {
      if (raw === null) return null as ModelSettings[K];
      const parsed = ProviderSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error(`modelProvider: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return parsed.data as ModelSettings[K];
    }
  }
  throw new Error(`unknown setting ${String(key)}`);
}

/** The environment's values for these keys, as `loadConfig` parsed them: the seed. */
export function seedFromConfig(config: Config): ModelSettings {
  return {
    model: config.model,
    modelReasoningEffort: config.modelReasoningEffort,
    modelTemperature: config.modelTemperature,
    modelMaxTokens: config.modelMaxTokens,
    diffModel: config.diffModel,
    diffBudgetTokens: config.diffBudgetTokens,
    reviewMode: config.reviewMode,
    modelProvider: config.bootstrap.modelProvider,
  };
}

export type SettingsListener = (changed: SettingKey, current: ModelSettings) => void;

export class Settings {
  private snapshot: ModelSettings;
  private readonly listeners: SettingsListener[] = [];

  private constructor(
    private readonly store: SettingsStore,
    initial: ModelSettings,
    private readonly log: Logger,
    private readonly now: () => Date,
  ) {
    this.snapshot = initial;
  }

  /**
   * Seed what the store lacks from the environment, read the rest from the
   * store, and hold the result. A row that no longer parses is logged and
   * replaced by the environment's value, so a bad row cannot keep the process
   * from booting; the log line is the only trace, and it names the key.
   */
  static open(
    store: SettingsStore,
    seed: ModelSettings,
    log: Logger,
    now: () => Date = () => new Date(),
  ): Settings {
    const at = now().toISOString();
    const current = { ...seed };
    for (const key of SETTING_KEYS) {
      const row = store.get(key);
      if (!row) {
        store.put(key, JSON.stringify(seed[key]), "seed", at);
        continue;
      }
      try {
        (current as Record<SettingKey, unknown>)[key] = parseSetting(key, JSON.parse(row.value));
      } catch (error) {
        log.warn("settings.invalid", { reason: key, ...errorFields(error) });
        store.put(key, JSON.stringify(seed[key]), "seed", at);
      }
    }
    return new Settings(store, current, log, now);
  }

  /**
   * The effective values now. A snapshot, and a deep one: the provider is an
   * object with a list inside it, and a consumer that edited a shared copy
   * would be editing what the next registration sends. Hold it for one
   * operation, not longer.
   */
  current(): ModelSettings {
    return structuredClone(this.snapshot);
  }

  /** Where each value came from, for a board that shows the source. */
  sources(): Record<SettingKey, "seed" | "owner"> {
    const out = {} as Record<SettingKey, "seed" | "owner">;
    for (const key of SETTING_KEYS) out[key] = this.store.get(key)?.source ?? "seed";
    return out;
  }

  /** Validate, write, hold, and tell the listeners. Throws on a bad value and writes nothing. */
  set<K extends SettingKey>(key: K, raw: unknown): ModelSettings[K] {
    const value = parseSetting(key, raw);
    this.store.put(key, JSON.stringify(value), "owner", this.now().toISOString());
    this.snapshot = { ...this.snapshot, [key]: value };
    this.log.info("settings.changed", { reason: key });
    for (const listener of this.listeners) listener(key, this.current());
    return value;
  }

  onChange(listener: SettingsListener): void {
    this.listeners.push(listener);
  }
}
