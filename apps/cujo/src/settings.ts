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
/**
 * The instance's settings: the models and the provider (decision 152), and
 * the limits and switches that move a run's cost or length (decision 164).
 * The name is the original one; every key here is read live at use.
 */
export interface ModelSettings {
  model: string;
  modelReasoningEffort: Config["modelReasoningEffort"];
  modelTemperature: number | null;
  modelMaxTokens: number | null;
  diffModel: string;
  diffBudgetTokens: number;
  /** The ceiling on a sandbox run's billed tokens (decision 165). */
  sandboxBudgetTokens: number;
  reviewMode: ReviewMode;
  modelProvider: ModelProviderConfig | null;
  /** The ceiling on a sandbox turn, in milliseconds. */
  turnTimeoutMs: number;
  /** The ceiling on a diff turn, which reads and posts. */
  diffTimeoutMs: number;
  /** Bytes of diff the diff review is handed. */
  diffBytes: number;
  /** How long a burst of pushes is folded into one run; 0 runs each at once. */
  pushDebounceMs: number;
  /** Questions per pull request per window; 0 turns conversation off. */
  converseLimit: number;
  converseWindowMs: number;
  /** The ceiling on one answer. */
  converseTimeoutMs: number;
  /** Whether the OCR sidecar is asked beside every sandbox run; its URL stays in the environment. */
  ocrEnabled: boolean;
}

export type SettingKey = keyof ModelSettings;

/** Which form on the instance page a key belongs to. */
export type SettingGroup = "models" | "provider" | "limits";

/**
 * The one list of keys, with the form each is drawn on. `SETTING_KEYS` and
 * the owner route's allowlist derive from it, and the route serves the
 * groups so the board draws a form per group without a list of its own.
 */
export const SETTING_GROUPS: Readonly<Record<SettingKey, SettingGroup>> = {
  model: "models",
  modelReasoningEffort: "models",
  modelTemperature: "models",
  modelMaxTokens: "models",
  diffModel: "models",
  diffBudgetTokens: "models",
  sandboxBudgetTokens: "models",
  reviewMode: "models",
  modelProvider: "provider",
  turnTimeoutMs: "limits",
  diffTimeoutMs: "limits",
  diffBytes: "limits",
  pushDebounceMs: "limits",
  converseLimit: "limits",
  converseWindowMs: "limits",
  converseTimeoutMs: "limits",
  ocrEnabled: "limits",
};

export const SETTING_KEYS: readonly SettingKey[] = Object.keys(SETTING_GROUPS) as SettingKey[];

/** A whole number, the way `count` reads one from the environment. */
function wholeNumber(key: string, raw: unknown, options: { zeroOk?: boolean } = {}): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a whole number`);
  }
  if (value === 0 && !options.zeroOk) throw new Error(`${key} must be above zero`);
  return value;
}

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
    case "diffBudgetTokens":
    case "sandboxBudgetTokens": {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
        throw new Error(`${key} must be a positive integer`);
      }
      return raw as ModelSettings[K];
    }
    case "reviewMode":
      return mode(typeof raw === "string" ? raw : undefined) as ModelSettings[K];
    case "turnTimeoutMs":
    case "diffTimeoutMs":
    case "diffBytes":
    case "converseWindowMs":
    case "converseTimeoutMs":
      return wholeNumber(key, raw) as ModelSettings[K];
    case "pushDebounceMs":
    case "converseLimit":
      return wholeNumber(key, raw, { zeroOk: true }) as ModelSettings[K];
    case "ocrEnabled": {
      if (typeof raw !== "boolean") throw new Error("ocrEnabled must be true or false");
      return raw as ModelSettings[K];
    }
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
    sandboxBudgetTokens: config.sandboxBudgetTokens,
    reviewMode: config.reviewMode,
    modelProvider: config.bootstrap.modelProvider,
    turnTimeoutMs: config.turnTimeoutMs,
    diffTimeoutMs: config.diffTimeoutMs,
    diffBytes: config.diffBytes,
    pushDebounceMs: config.pushDebounceMs,
    converseLimit: config.converseLimit,
    converseWindowMs: config.converseWindowMs,
    converseTimeoutMs: config.converseTimeoutMs,
    // On when a sidecar is configured, the way it always was; the switch is
    // then the owner's, and the URL stays what the environment says.
    ocrEnabled: config.ocrSidecarUrl !== null,
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
