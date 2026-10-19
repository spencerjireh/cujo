"use client";

import { RelativeTime } from "@/components/RelativeTime";
import {
  type BotState,
  type ProviderSettings,
  type ProviderTestResult,
  listProviderModels,
  testProvider,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { deliveryTone, describePermissions } from "@/lib/owner/instance";
import {
  type ProviderDraft,
  emptyDraft,
  modelOptions,
  providerOf,
  testModelOf,
} from "@/lib/owner/providers";
import { MODE_LABELS } from "@/lib/owner/settings";
import type { SettingsForm } from "@/lib/owner/settings-draft";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { BUTTON, OwnerSection } from "../OwnerPage";
import { Advanced, Check, Field, INPUT } from "./fields";

/**
 * The settings page's sections (decision 175). Each edits its part of one
 * shared draft; the page saves the draft once. Labels say what a value does
 * for the owner, and the knobs most deploys never touch are under Advanced.
 */

type Set = (patch: Partial<SettingsForm>) => void;

const TONE = {
  ok: "text-sev-live",
  warn: "text-sev-high",
  critical: "text-sev-critical",
} as const;

export function ModelsSection({
  form,
  set,
  served,
}: {
  form: SettingsForm;
  set: Set;
  /** The providers as saved: the picker offers what the harness can serve now. */
  served: ProviderSettings[];
}) {
  const anthropic = served.find((p) => p.kind === "anthropic");
  const catalog = useQuery({
    queryKey: ownerKeys.providerModels("anthropic"),
    queryFn: () => (anthropic ? listProviderModels(anthropic) : Promise.resolve([])),
    enabled: anthropic !== undefined,
    staleTime: 60 * 60_000,
  });
  const listId = useId();
  const text =
    (key: keyof SettingsForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      set({ [key]: event.target.value });
  return (
    <OwnerSection
      id="models"
      title="Models"
      lead="Which model reviews run on, written as provider/model from the providers below. A change applies to the next review."
    >
      <datalist id={listId}>
        {modelOptions(served, catalog.data).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Model for full reviews" hint="Runs the pull request in the sandbox.">
          <input
            className={INPUT}
            value={form.model}
            onChange={text("model")}
            list={listId}
            placeholder="provider/model"
            spellCheck={false}
          />
        </Field>
        <Field label="Model for diff reviews" hint="Leave empty to use the full-review model.">
          <input
            className={INPUT}
            value={form.diffModel}
            onChange={text("diffModel")}
            list={listId}
            placeholder="same as full reviews"
            spellCheck={false}
          />
        </Field>
        <Field label="Default review mode" hint="Used when a repository does not set one.">
          <select className={INPUT} value={form.reviewMode} onChange={text("reviewMode")}>
            <option value="sandbox">{MODE_LABELS.sandbox}</option>
            <option value="diff">{MODE_LABELS.diff}</option>
          </select>
        </Field>
        <div />
        <Field label="Token budget, full review" hint="Billed tokens per run, sub-agents included.">
          <input
            className={INPUT}
            value={form.sandboxBudgetTokens}
            onChange={text("sandboxBudgetTokens")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Token budget, diff review" hint="Billed tokens per run.">
          <input
            className={INPUT}
            value={form.diffBudgetTokens}
            onChange={text("diffBudgetTokens")}
            inputMode="numeric"
          />
        </Field>
      </div>
      <Advanced>
        <Field
          label="Reasoning effort"
          hint="Empty for the provider's default. For example: low, medium, high."
        >
          <input
            className={INPUT}
            value={form.modelReasoningEffort}
            onChange={text("modelReasoningEffort")}
          />
        </Field>
        <Field label="Temperature" hint="Empty for the provider's default.">
          <input
            className={INPUT}
            value={form.modelTemperature}
            onChange={text("modelTemperature")}
            inputMode="decimal"
          />
        </Field>
        <Field label="Max output tokens" hint="Empty for the provider's default.">
          <input
            className={INPUT}
            value={form.modelMaxTokens}
            onChange={text("modelMaxTokens")}
            inputMode="numeric"
          />
        </Field>
      </Advanced>
    </OwnerSection>
  );
}

/** The answer a Test button got. */
function TestLine({ result }: { result: ProviderTestResult | Error | null }) {
  if (!result) return null;
  if (result instanceof Error) {
    return <span className={`text-sm ${TONE.critical}`}>{result.message}</span>;
  }
  return result.ok ? (
    <span className={`text-sm ${TONE.ok}`}>Works, answered in {result.latencyMs} ms</span>
  ) : (
    <span className={`text-sm ${TONE.critical}`}>{result.error ?? "Failed"}</span>
  );
}

/** One provider's fields, and a test of what is typed in them right now. */
function ProviderCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: ProviderDraft;
  onChange: (draft: ProviderDraft) => void;
  onRemove: () => void;
}) {
  const [result, setResult] = useState<ProviderTestResult | Error | null>(null);
  const [testing, setTesting] = useState(false);
  const model = testModelOf(draft);
  const test = async () => {
    if (!model) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await testProvider(providerOf(draft), model));
    } catch (error) {
      setResult(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setTesting(false);
    }
  };
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [key]: event.target.value } as ProviderDraft);
  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1 text-sm font-medium text-fg">
        {draft.kind === "anthropic" ? "Anthropic" : draft.name || "OpenAI-compatible"}
      </legend>
      <div className="grid gap-5 md:grid-cols-2">
        {draft.kind === "openai" ? (
          <>
            <Field label="Name" hint="The part before the slash in a model name.">
              <input
                className={INPUT}
                value={draft.name}
                onChange={set("name")}
                spellCheck={false}
              />
            </Field>
            <Field label="Base URL" hint="Including /v1.">
              <input
                className={INPUT}
                value={draft.baseUrl}
                onChange={set("baseUrl")}
                spellCheck={false}
              />
            </Field>
          </>
        ) : null}
        <Field label="API key" hint="Shown masked. Type a new one to replace it.">
          <input
            className={INPUT}
            value={draft.apiKey}
            onChange={set("apiKey")}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        {draft.kind === "openai" ? (
          <>
            <Field label="Models" hint="name=provider id, separated by commas.">
              <input
                className={INPUT}
                value={draft.models}
                onChange={set("models")}
                spellCheck={false}
              />
            </Field>
            <Field label="Context window" hint="Tokens.">
              <input
                className={INPUT}
                value={draft.contextWindow}
                onChange={set("contextWindow")}
                inputMode="numeric"
              />
            </Field>
            <Field label="Max output tokens">
              <input
                className={INPUT}
                value={draft.maxTokens}
                onChange={set("maxTokens")}
                inputMode="numeric"
              />
            </Field>
            <Check
              checked={draft.reasoning}
              onChange={(reasoning) => onChange({ ...draft, reasoning })}
            >
              These models take a reasoning effort
            </Check>
          </>
        ) : (
          <p className="self-end text-sm text-fg-muted">
            Models, limits and prices come from Anthropic&rsquo;s catalog.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON}
          disabled={testing || !model}
          onClick={() => void test()}
        >
          {testing ? "Testing…" : `Test${model ? ` ${model}` : ""}`}
        </button>
        <button type="button" className={BUTTON} onClick={onRemove}>
          Remove
        </button>
        <TestLine result={result} />
      </div>
    </fieldset>
  );
}

export function ProvidersSection({ form, set }: { form: SettingsForm; set: Set }) {
  const drafts = form.providers;
  const hasAnthropic = drafts.some((d) => d.kind === "anthropic");
  const update = (providers: ProviderDraft[]) => set({ providers });
  return (
    <OwnerSection
      id="providers"
      title="Providers"
      lead="Where the models are served from. Test makes one short call with what is typed, saved or not."
    >
      <div className="flex flex-col gap-4">
        {drafts.length === 0 ? (
          <p className="text-sm text-fg-muted">No provider yet. Add one to pick a model.</p>
        ) : null}
        {drafts.map((draft, index) => (
          <ProviderCard
            // A provider's position is its identity while the form is open: names change as typed.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            key={index}
            draft={draft}
            onChange={(next) => update(drafts.map((old, i) => (i === index ? next : old)))}
            onRemove={() => update(drafts.filter((_, i) => i !== index))}
          />
        ))}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={BUTTON}
            disabled={hasAnthropic}
            onClick={() => update([...drafts, emptyDraft("anthropic")])}
          >
            Add Anthropic
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => update([...drafts, emptyDraft("openai")])}
          >
            Add OpenAI-compatible
          </button>
        </div>
      </div>
    </OwnerSection>
  );
}

export function LimitsSection({ form, set }: { form: SettingsForm; set: Set }) {
  const text = (key: keyof SettingsForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    set({ [key]: event.target.value });
  return (
    <OwnerSection
      id="limits"
      title="Limits"
      lead="How long a run may take and how much it may do. A change applies to the next run; a run under way keeps its limits."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Time limit, full review" hint="Seconds. The run stops past it.">
          <input
            className={INPUT}
            value={form.turnTimeoutMs}
            onChange={text("turnTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Time limit, diff review" hint="Seconds.">
          <input
            className={INPUT}
            value={form.diffTimeoutMs}
            onChange={text("diffTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field
          label="Questions per pull request"
          hint="How many @cujo-guard questions it answers per window. 0 turns replies off."
        >
          <input
            className={INPUT}
            value={form.converseLimit}
            onChange={text("converseLimit")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Question window" hint="Seconds.">
          <input
            className={INPUT}
            value={form.converseWindowMs}
            onChange={text("converseWindowMs")}
            inputMode="numeric"
          />
        </Field>
        <div className="md:col-span-2">
          <Check
            checked={form.executeDeclared}
            onChange={(executeDeclared) => set({ executeDeclared })}
          >
            Run the install and tests a repository declares in .cujo.yml before the model reads the
            results
          </Check>
        </div>
      </div>
      <Advanced>
        <Field
          label="Wait after a push"
          hint="Seconds. Pushes inside it run once. 0 runs each push."
        >
          <input
            className={INPUT}
            value={form.pushDebounceMs}
            onChange={text("pushDebounceMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Time limit, one answer" hint="Seconds.">
          <input
            className={INPUT}
            value={form.converseTimeoutMs}
            onChange={text("converseTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Time limit, one install or test command" hint="Seconds.">
          <input
            className={INPUT}
            value={form.executeStepTimeoutMs}
            onChange={text("executeStepTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Diff size sent to the reviewer" hint="Bytes.">
          <input
            className={INPUT}
            value={form.diffBytes}
            onChange={text("diffBytes")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Command report size sent to the reviewer" hint="Bytes per report.">
          <input
            className={INPUT}
            value={form.executedReportBytes}
            onChange={text("executedReportBytes")}
            inputMode="numeric"
          />
        </Field>
        <div className="self-end">
          <Check checked={form.ocrEnabled} onChange={(ocrEnabled) => set({ ocrEnabled })}>
            Also run the OCR sidecar review on every full review. This doubles the cost.
          </Check>
        </div>
      </Advanced>
    </OwnerSection>
  );
}

export function AppSection({ bot, failed }: { bot: BotState | undefined; failed: boolean }) {
  return (
    <OwnerSection
      id="app"
      title="GitHub App"
      lead={
        failed
          ? "GitHub did not answer just now. The settings above still work."
          : bot
            ? describePermissions(bot.permissions)
            : "Loading…"
      }
    >
      {bot ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <table className="w-full border-collapse text-sm">
            <caption className="mb-2 text-left text-xs text-fg-muted">
              Permissions{" "}
              <a
                href={bot.app.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                {bot.app.name} on GitHub
              </a>
            </caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-muted">
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  Permission
                </th>
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  Needs
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Has
                </th>
              </tr>
            </thead>
            <tbody>
              {bot.permissions.map((permission) => (
                <tr key={permission.name} className="border-b border-line">
                  <td className="py-1.5 pr-4 font-mono text-xs">{permission.name}</td>
                  <td className="py-1.5 pr-4 text-fg-muted">{permission.needed}</td>
                  <td className={`py-1.5 ${permission.ok ? TONE.ok : TONE.critical}`}>
                    {permission.held ?? "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full border-collapse text-sm">
            <caption className="mb-2 text-left text-xs text-fg-muted">Installations</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-muted">
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  Account
                </th>
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  Repositories
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {bot.installations.map((installation) => (
                <tr key={installation.id} className="border-b border-line">
                  <td className="py-1.5 pr-4">
                    <span className="font-mono text-xs">{installation.account.login}</span>{" "}
                    <span className="text-fg-muted">
                      ({installation.account.type.toLowerCase()})
                    </span>
                  </td>
                  <td className="py-1.5 pr-4 text-fg-muted">
                    {installation.repositories} ({installation.repositorySelection})
                  </td>
                  <td className={`py-1.5 ${installation.suspended ? TONE.critical : TONE.ok}`}>
                    {installation.suspended ? "Suspended" : "Active"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </OwnerSection>
  );
}

export function DeliveriesSection({ bot }: { bot: BotState | undefined }) {
  if (!bot) return null;
  return (
    <OwnerSection
      id="deliveries"
      title="Deliveries"
      lead="The newest webhook events GitHub sent, and how Cujo answered. A 503 is a delivery deferred while Cujo started; GitHub retries it."
    >
      {bot.deliveries.length === 0 ? (
        <p className="text-sm text-fg-muted">No deliveries yet.</p>
      ) : (
        <table className="w-full max-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-muted">
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Event
              </th>
              <th scope="col" className="py-1.5 pr-4 font-medium">
                When
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Answer
              </th>
            </tr>
          </thead>
          <tbody>
            {bot.deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-b border-line">
                <td className="py-1.5 pr-4">
                  <span className="font-mono text-xs">{delivery.event}</span>
                  {delivery.action ? (
                    <span className="text-fg-muted"> {delivery.action}</span>
                  ) : null}
                  {delivery.redelivery ? (
                    <span className="text-fg-muted"> (redelivered)</span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-4 text-fg-muted">
                  <RelativeTime iso={delivery.deliveredAt} />
                </td>
                <td className={`py-1.5 font-mono text-xs ${TONE[deliveryTone(delivery)]}`}>
                  {delivery.statusCode ?? "no answer"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </OwnerSection>
  );
}
