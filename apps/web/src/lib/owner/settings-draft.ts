import type { InstanceSettings, ReviewMode } from "@/lib/api/owner-client";
import { type ProviderDraft, draftOf, providerOf } from "./providers";

/**
 * The settings page as one form (decision 175). It used to be three forms
 * with three save buttons, and an edit in one was lost without a word when
 * another was saved. Now every field is in one draft, and a save sends only
 * the keys that differ from what was served, in one PATCH: the server takes
 * any subset and validates them together before writing any.
 *
 * Times are seconds in the form and milliseconds on the wire: nobody types a
 * ceiling in milliseconds.
 */

export interface SettingsForm {
  model: string;
  diffModel: string;
  modelReasoningEffort: string;
  modelTemperature: string;
  modelMaxTokens: string;
  diffBudgetTokens: string;
  sandboxBudgetTokens: string;
  reviewMode: ReviewMode;
  providers: ProviderDraft[];
  turnTimeoutMs: string;
  diffTimeoutMs: string;
  diffBytes: string;
  pushDebounceMs: string;
  converseLimit: string;
  converseWindowMs: string;
  converseTimeoutMs: string;
  ocrEnabled: boolean;
  executeDeclared: boolean;
  executeStepTimeoutMs: string;
  executedReportBytes: string;
}

const seconds = (ms: number) => String(Math.round(ms / 1000));
const millis = (s: string) => Math.round(Number(s) * 1000);
const optional = (value: number | null) => (value === null ? "" : String(value));

export function formOf(s: InstanceSettings): SettingsForm {
  return {
    model: s.model ?? "",
    diffModel: s.diffModel ?? "",
    modelReasoningEffort: s.modelReasoningEffort,
    modelTemperature: optional(s.modelTemperature),
    modelMaxTokens: optional(s.modelMaxTokens),
    diffBudgetTokens: String(s.diffBudgetTokens),
    sandboxBudgetTokens: String(s.sandboxBudgetTokens),
    reviewMode: s.reviewMode,
    providers: s.modelProviders.map(draftOf),
    turnTimeoutMs: seconds(s.turnTimeoutMs),
    diffTimeoutMs: seconds(s.diffTimeoutMs),
    diffBytes: String(s.diffBytes),
    pushDebounceMs: seconds(s.pushDebounceMs),
    converseLimit: String(s.converseLimit),
    converseWindowMs: seconds(s.converseWindowMs),
    converseTimeoutMs: seconds(s.converseTimeoutMs),
    ocrEnabled: s.ocrEnabled,
    executeDeclared: s.executeDeclared,
    executeStepTimeoutMs: seconds(s.executeStepTimeoutMs),
    executedReportBytes: String(s.executedReportBytes),
  };
}

/** The form read back into settings: every key, whether it changed or not. */
function settingsOf(form: SettingsForm): InstanceSettings {
  return {
    model: form.model.trim() || null,
    diffModel: form.diffModel.trim() || null,
    modelReasoningEffort: form.modelReasoningEffort,
    modelTemperature: form.modelTemperature === "" ? null : Number(form.modelTemperature),
    modelMaxTokens: form.modelMaxTokens === "" ? null : Number(form.modelMaxTokens),
    diffBudgetTokens: Number(form.diffBudgetTokens),
    sandboxBudgetTokens: Number(form.sandboxBudgetTokens),
    reviewMode: form.reviewMode,
    modelProviders: form.providers.map(providerOf),
    turnTimeoutMs: millis(form.turnTimeoutMs),
    diffTimeoutMs: millis(form.diffTimeoutMs),
    diffBytes: Number(form.diffBytes),
    pushDebounceMs: millis(form.pushDebounceMs),
    converseLimit: Number(form.converseLimit),
    converseWindowMs: millis(form.converseWindowMs),
    converseTimeoutMs: millis(form.converseTimeoutMs),
    ocrEnabled: form.ocrEnabled,
    executeDeclared: form.executeDeclared,
    executeStepTimeoutMs: millis(form.executeStepTimeoutMs),
    executedReportBytes: Number(form.executedReportBytes),
  };
}

/**
 * The keys whose value in the form differs from what was served. The served
 * side goes through the form and back too, so a value the form cannot show
 * exactly (a ceiling that is not a whole second) is not a change by itself.
 */
export function patchOf(form: SettingsForm, served: InstanceSettings): Partial<InstanceSettings> {
  const next = settingsOf(form);
  const base = settingsOf(formOf(served));
  const patch: Partial<InstanceSettings> = {};
  for (const key of Object.keys(next) as (keyof InstanceSettings)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(base[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return patch;
}
