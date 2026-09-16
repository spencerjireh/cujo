"use client";

import { RelativeTime } from "@/components/RelativeTime";
import {
  type BotState,
  type Health,
  type InstanceSettings,
  type InstanceSettingsView,
  fetchBot,
  fetchHealth,
  fetchInstanceSettings,
  saveInstanceSettings,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import {
  changedKeys,
  deliveryTone,
  describeHealth,
  describePermissions,
} from "@/lib/owner/instance";
import { MODE_LABELS } from "@/lib/owner/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useEffect, useId, useState } from "react";

/**
 * The instance (decision 157): what the reviews run on, the provider they
 * run through, the App as GitHub sees it against what the reviews need,
 * and whether the process can take a run. The first page that edits the
 * settings of decision 152; until it, a model change was a redeploy.
 */

const FIELD =
  "mt-1 block w-full max-w-[40ch] rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent";
const BUTTON =
  "rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50";
const TONE: Record<"ok" | "warn" | "critical", string> = {
  ok: "text-sev-live",
  warn: "text-sev-high",
  critical: "text-sev-critical",
};

/** A labelled control: the label points at the child by id, so the pair reads as one. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="font-mono text-xs text-fg">
        {label}
      </label>
      {hint ? <span className="ml-2 font-mono text-xs text-fg-muted">{hint}</span> : null}
      {cloneElement(children, { id })}
    </div>
  );
}

/** The review models and their sampling: a form that saves as one PATCH. */
function Models({
  view,
  onSave,
  busy,
}: {
  view: InstanceSettingsView;
  onSave: (patch: Partial<InstanceSettings>) => void;
  busy: boolean;
}) {
  const s = view.settings;
  const [draft, setDraft] = useState({
    model: s.model,
    diffModel: s.diffModel,
    modelReasoningEffort: s.modelReasoningEffort,
    modelTemperature: s.modelTemperature === null ? "" : String(s.modelTemperature),
    modelMaxTokens: s.modelMaxTokens === null ? "" : String(s.modelMaxTokens),
    diffBudgetTokens: String(s.diffBudgetTokens),
    reviewMode: s.reviewMode,
  });
  useEffect(() => {
    setDraft({
      model: s.model,
      diffModel: s.diffModel,
      modelReasoningEffort: s.modelReasoningEffort,
      modelTemperature: s.modelTemperature === null ? "" : String(s.modelTemperature),
      modelMaxTokens: s.modelMaxTokens === null ? "" : String(s.modelMaxTokens),
      diffBudgetTokens: String(s.diffBudgetTokens),
      reviewMode: s.reviewMode,
    });
  }, [s]);
  const changed = changedKeys(view.sources);
  const set =
    (key: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [key]: event.target.value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      model: draft.model,
      diffModel: draft.diffModel,
      modelReasoningEffort: draft.modelReasoningEffort,
      modelTemperature: draft.modelTemperature === "" ? null : Number(draft.modelTemperature),
      modelMaxTokens: draft.modelMaxTokens === "" ? null : Number(draft.modelMaxTokens),
      diffBudgetTokens: Number(draft.diffBudgetTokens),
      reviewMode: draft.reviewMode,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">Review models</h2>
        <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
          What each review runs on, as provider/model. A change here applies to the next session;
          nothing restarts.
          {changed.length
            ? ` Changed from the environment's seed: ${changed.join(", ")}.`
            : " Everything is still what the environment seeded."}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="sandbox review" hint="runs the pull request">
          <input className={FIELD} value={draft.model} onChange={set("model")} spellCheck={false} />
        </Field>
        <Field label="diff review" hint="reads the pull request">
          <input
            className={FIELD}
            value={draft.diffModel}
            onChange={set("diffModel")}
            spellCheck={false}
          />
        </Field>
        <Field label="reasoning effort" hint="empty for the provider's default">
          <input
            className={FIELD}
            value={draft.modelReasoningEffort}
            onChange={set("modelReasoningEffort")}
            placeholder="none, low, medium, high…"
          />
        </Field>
        <Field label="temperature" hint="empty for the provider's default">
          <input
            className={FIELD}
            value={draft.modelTemperature}
            onChange={set("modelTemperature")}
            inputMode="decimal"
          />
        </Field>
        <Field label="max output tokens" hint="empty for the provider's default">
          <input
            className={FIELD}
            value={draft.modelMaxTokens}
            onChange={set("modelMaxTokens")}
            inputMode="numeric"
          />
        </Field>
        <Field label="diff review budget" hint="billed tokens per run">
          <input
            className={FIELD}
            value={draft.diffBudgetTokens}
            onChange={set("diffBudgetTokens")}
            inputMode="numeric"
          />
        </Field>
        <Field label="review mode default" hint="when a repository says nothing">
          <select className={FIELD} value={draft.reviewMode} onChange={set("reviewMode")}>
            <option value="sandbox">{MODE_LABELS.sandbox}</option>
            <option value="diff">{MODE_LABELS.diff}</option>
          </select>
        </Field>
      </div>
      <div>
        <button type="submit" disabled={busy} className={BUTTON}>
          Save models
        </button>
      </div>
    </form>
  );
}

/** The provider: the key is shown masked and kept unless a new one is typed. */
function Provider({
  view,
  onSave,
  busy,
}: {
  view: InstanceSettingsView;
  onSave: (patch: Partial<InstanceSettings>) => void;
  busy: boolean;
}) {
  const p = view.settings.modelProvider;
  const [draft, setDraft] = useState({
    name: p?.name ?? "",
    baseUrl: p?.baseUrl ?? "",
    apiKey: p?.apiKey ?? "",
    models: (p?.models ?? []).map((m) => `${m.name}=${m.modelId}`).join(", "),
    contextWindow: String(p?.contextWindow ?? 128000),
    maxTokens: String(p?.maxTokens ?? 16384),
    reasoning: p?.reasoning ?? true,
  });
  useEffect(() => {
    setDraft({
      name: p?.name ?? "",
      baseUrl: p?.baseUrl ?? "",
      apiKey: p?.apiKey ?? "",
      models: (p?.models ?? []).map((m) => `${m.name}=${m.modelId}`).join(", "),
      contextWindow: String(p?.contextWindow ?? 128000),
      maxTokens: String(p?.maxTokens ?? 16384),
      reasoning: p?.reasoning ?? true,
    });
  }, [p]);
  const set = (key: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({
      ...d,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const models = draft.models
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq === -1
          ? { name: pair, modelId: pair }
          : { name: pair.slice(0, eq).trim(), modelId: pair.slice(eq + 1).trim() };
      });
    onSave({
      modelProvider: {
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        models,
        contextWindow: Number(draft.contextWindow),
        maxTokens: Number(draft.maxTokens),
        reasoning: draft.reasoning,
      },
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">Provider</h2>
        <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
          Where the models are served from. The key is shown masked and stays as it is unless you
          type a new one; saving registers the provider on the harness at once.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="name" hint="the part before the slash in a model name">
          <input className={FIELD} value={draft.name} onChange={set("name")} spellCheck={false} />
        </Field>
        <Field label="base url">
          <input
            className={FIELD}
            value={draft.baseUrl}
            onChange={set("baseUrl")}
            spellCheck={false}
          />
        </Field>
        <Field label="api key">
          <input
            className={FIELD}
            value={draft.apiKey}
            onChange={set("apiKey")}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label="models" hint="name=provider id, comma-separated">
          <input
            className={FIELD}
            value={draft.models}
            onChange={set("models")}
            spellCheck={false}
          />
        </Field>
        <Field label="context window" hint="tokens">
          <input
            className={FIELD}
            value={draft.contextWindow}
            onChange={set("contextWindow")}
            inputMode="numeric"
          />
        </Field>
        <Field label="max output tokens">
          <input
            className={FIELD}
            value={draft.maxTokens}
            onChange={set("maxTokens")}
            inputMode="numeric"
          />
        </Field>
        <label className="flex items-center gap-2 font-mono text-xs text-fg">
          <input type="checkbox" checked={draft.reasoning} onChange={set("reasoning")} />
          the models reason, so an effort means something to them
        </label>
      </div>
      <div>
        <button type="submit" disabled={busy} className={BUTTON}>
          Save provider
        </button>
      </div>
    </form>
  );
}

/** Seconds in the form, milliseconds on the wire: nobody types a ceiling in milliseconds. */
const seconds = (ms: number) => String(Math.round(ms / 1000));
const millis = (s: string) => Math.round(Number(s) * 1000);

/**
 * The limits and switches (decision 164): what bounds a run's cost and
 * length. One PATCH, like the two forms above; a change applies to the next
 * run, and a running one keeps the window it started under.
 */
function Limits({
  view,
  onSave,
  busy,
}: {
  view: InstanceSettingsView;
  onSave: (patch: Partial<InstanceSettings>) => void;
  busy: boolean;
}) {
  const s = view.settings;
  const fromView = () => ({
    turnTimeoutMs: seconds(s.turnTimeoutMs),
    diffTimeoutMs: seconds(s.diffTimeoutMs),
    diffBytes: String(s.diffBytes),
    pushDebounceMs: seconds(s.pushDebounceMs),
    converseLimit: String(s.converseLimit),
    converseWindowMs: seconds(s.converseWindowMs),
    converseTimeoutMs: seconds(s.converseTimeoutMs),
    ocrEnabled: s.ocrEnabled,
  });
  const [draft, setDraft] = useState(fromView);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft follows the served settings, and `fromView` closes over them.
  useEffect(() => setDraft(fromView()), [s]);
  const set = (key: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({
      ...d,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      turnTimeoutMs: millis(draft.turnTimeoutMs),
      diffTimeoutMs: millis(draft.diffTimeoutMs),
      diffBytes: Number(draft.diffBytes),
      pushDebounceMs: millis(draft.pushDebounceMs),
      converseLimit: Number(draft.converseLimit),
      converseWindowMs: millis(draft.converseWindowMs),
      converseTimeoutMs: millis(draft.converseTimeoutMs),
      ocrEnabled: draft.ocrEnabled,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">Limits and switches</h2>
        <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
          What bounds a run&rsquo;s length and cost. A change applies to the next run; a run already
          under way keeps the window it started with. Times are in seconds.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="sandbox run ceiling" hint="seconds; the turn is cancelled past it">
          <input
            className={FIELD}
            value={draft.turnTimeoutMs}
            onChange={set("turnTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="diff run ceiling" hint="seconds">
          <input
            className={FIELD}
            value={draft.diffTimeoutMs}
            onChange={set("diffTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="diff bytes" hint="how much of a diff the reader is handed">
          <input
            className={FIELD}
            value={draft.diffBytes}
            onChange={set("diffBytes")}
            inputMode="numeric"
          />
        </Field>
        <Field label="push window" hint="seconds a burst of pushes is folded into; 0 runs each">
          <input
            className={FIELD}
            value={draft.pushDebounceMs}
            onChange={set("pushDebounceMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="questions per pull request" hint="per window; 0 turns conversation off">
          <input
            className={FIELD}
            value={draft.converseLimit}
            onChange={set("converseLimit")}
            inputMode="numeric"
          />
        </Field>
        <Field label="question window" hint="seconds">
          <input
            className={FIELD}
            value={draft.converseWindowMs}
            onChange={set("converseWindowMs")}
            inputMode="numeric"
          />
        </Field>
        <Field label="answer ceiling" hint="seconds">
          <input
            className={FIELD}
            value={draft.converseTimeoutMs}
            onChange={set("converseTimeoutMs")}
            inputMode="numeric"
          />
        </Field>
        <label className="flex items-center gap-2 self-end font-mono text-xs text-fg">
          <input type="checkbox" checked={draft.ocrEnabled} onChange={set("ocrEnabled")} />
          ask the OCR sidecar beside every sandbox run, a second full review at the same price
        </label>
      </div>
      <div>
        <button type="submit" disabled={busy} className={BUTTON}>
          Save limits
        </button>
      </div>
    </form>
  );
}

function Bot({ bot }: { bot: BotState }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">The App</h2>
        <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
          <a
            href={bot.app.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-4"
          >
            {bot.app.name}
          </a>{" "}
          as GitHub sees it, against what the reviews need. {describePermissions(bot.permissions)}
        </p>
      </div>
      <ul className="flex max-w-[60ch] flex-col">
        {bot.permissions.map((permission) => (
          <li
            key={permission.name}
            className="grid grid-cols-[1fr_6rem_6rem] items-baseline gap-3 border-t border-line py-1.5 font-mono text-xs"
          >
            <span>{permission.name}</span>
            <span className="text-fg-muted">needs {permission.needed}</span>
            <span className={permission.ok ? TONE.ok : TONE.critical}>
              {permission.held ? `holds ${permission.held}` : "holds none"}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <h3 className="text-base">Installations</h3>
        <ul className="mt-1 flex max-w-[60ch] flex-col">
          {bot.installations.map((installation) => (
            <li
              key={installation.id}
              className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-t border-line py-1.5 font-mono text-xs"
            >
              <span>
                {installation.account.login}
                <span className="text-fg-muted"> · {installation.account.type.toLowerCase()}</span>
              </span>
              <span className="text-fg-muted">
                {installation.repositories}{" "}
                {installation.repositories === 1 ? "repository" : "repositories"}
              </span>
              <span className={installation.suspended ? TONE.critical : "text-fg-muted"}>
                {installation.suspended ? "suspended" : installation.repositorySelection}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-base">Deliveries</h3>
        <p className="mt-1 max-w-[68ch] font-mono text-xs text-fg-muted">
          The newest webhook deliveries and what this process answered.
        </p>
        <ul className="mt-1 flex max-w-[68ch] flex-col">
          {bot.deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-t border-line py-1.5 font-mono text-xs"
            >
              <span>
                {delivery.event}
                {delivery.action ? (
                  <span className="text-fg-muted"> · {delivery.action}</span>
                ) : null}
                {delivery.redelivery ? <span className="text-fg-muted"> · redelivered</span> : null}
              </span>
              <span className="text-fg-muted">
                <RelativeTime iso={delivery.deliveredAt} />
              </span>
              <span className={TONE[deliveryTone(delivery)]}>
                {delivery.statusCode ?? "no answer"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HealthLine({ health }: { health: Health }) {
  return (
    <p className="font-mono text-xs text-fg-muted">
      <span className={health.ready ? TONE.ok : TONE.warn}>
        {health.ready ? "ready" : "not ready"}
      </span>{" "}
      · {describeHealth(health)} Up {Math.round(health.uptimeMs / 60000)} min.
    </p>
  );
}

export function InstanceView() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ownerKeys.instance(),
    queryFn: ({ signal }) => fetchInstanceSettings(undefined, signal),
    staleTime: 30_000,
  });
  const bot = useQuery({
    queryKey: ownerKeys.bot(),
    queryFn: ({ signal }) => fetchBot(undefined, signal),
    staleTime: 60_000,
    retry: false,
  });
  const health = useQuery({
    queryKey: ownerKeys.health(),
    queryFn: ({ signal }) => fetchHealth(undefined, signal),
    refetchInterval: 15_000,
  });
  const save = useMutation({
    mutationFn: (patch: Partial<InstanceSettings>) => saveInstanceSettings(patch),
    onSuccess: (view) => client.setQueryData(ownerKeys.instance(), view),
  });

  return (
    <article className="flex flex-col gap-10">
      <header>
        <h1 className="text-2xl">Instance</h1>
        {health.data ? (
          <div className="mt-2">
            <HealthLine health={health.data} />
          </div>
        ) : null}
      </header>
      {settings.error ? (
        <p className="text-sm text-sev-critical">
          The settings could not be loaded: {settings.error.message}
        </p>
      ) : settings.data ? (
        <>
          <Models
            view={settings.data}
            busy={save.isPending}
            onSave={(patch) => save.mutate(patch)}
          />
          <Provider
            view={settings.data}
            busy={save.isPending}
            onSave={(patch) => save.mutate(patch)}
          />
          <Limits
            view={settings.data}
            busy={save.isPending}
            onSave={(patch) => save.mutate(patch)}
          />
          {save.error ? (
            <p className="-mt-6 font-mono text-xs text-sev-critical">
              Not saved: {save.error.message}
            </p>
          ) : null}
          {save.isSuccess ? <p className="-mt-6 font-mono text-xs text-sev-live">Saved.</p> : null}
        </>
      ) : (
        <p className="text-sm text-fg-muted">Loading…</p>
      )}
      {bot.error ? (
        <p className="font-mono text-xs text-sev-high">
          GitHub did not answer for the App just now; the settings above still work.
        </p>
      ) : bot.data ? (
        <Bot bot={bot.data} />
      ) : null}
    </article>
  );
}
