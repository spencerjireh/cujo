"use client";

import { Toast, useToast } from "@/components/ui/Toast";
import { type InstanceSettingsView, saveInstanceSettings } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import {
  ownerBotOptions,
  ownerHealthOptions,
  ownerInstanceOptions,
  ownerRepositoriesOptions,
} from "@/lib/api/queries";
import { setupSteps } from "@/lib/owner/activity";
import { describeHealth } from "@/lib/owner/instance";
import { type SettingsForm, formOf, patchOf } from "@/lib/owner/settings-draft";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BUTTON, OwnerPage, PRIMARY_BUTTON } from "../OwnerPage";
import { SetupChecklist } from "../SetupChecklist";
import {
  AppSection,
  DeliveriesSection,
  LimitsSection,
  ModelsSection,
  ProvidersSection,
} from "./sections";

/**
 * Settings (decisions 157, 174, 175; the page was "Instance"). What reviews run
 * on, the providers, the limits, and the App as GitHub sees it, as one form
 * with one save bar: the bar appears when anything differs from what was
 * saved, and leaving with unsaved changes asks first.
 */

const NAV = [
  { href: "#models", label: "Models" },
  { href: "#providers", label: "Providers" },
  { href: "#limits", label: "Limits" },
  { href: "#app", label: "GitHub App" },
  { href: "#deliveries", label: "Deliveries" },
];

function Form({ view }: { view: InstanceSettingsView }) {
  const client = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(() => formOf(view.settings));
  const patch = patchOf(form, view.settings);
  const dirty = Object.keys(patch).length > 0;
  const { toast, show, close } = useToast();

  // A refetch of the served settings resets the form only when nothing is
  // being edited; otherwise it would throw away what is typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the served settings only
  useEffect(() => {
    if (!dirty) setForm(formOf(view.settings));
  }, [view.settings]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => saveInstanceSettings(patch),
    onSuccess: (next) => {
      client.setQueryData(ownerKeys.instance(), next);
      setForm(formOf(next.settings));
      show({ message: "Settings saved." });
      // Whether a model is configured moves with a save; the poll would get there in 15 s.
      void client.invalidateQueries({ queryKey: ownerKeys.health() });
      void client.invalidateQueries({ queryKey: ownerKeys.providerModels("anthropic") });
    },
  });
  const set = (next: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...next }));

  return (
    <>
      <div className="flex flex-col gap-12">
        <ModelsSection form={form} set={set} served={view.settings.modelProviders} />
        <ProvidersSection form={form} set={set} />
        <LimitsSection form={form} set={set} />
      </div>
      {dirty ? (
        <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-fg">
              {save.error ? (
                <span className="text-sev-critical">Not saved: {save.error.message}</span>
              ) : (
                "You have unsaved changes."
              )}
            </p>
            <button
              type="button"
              className={BUTTON}
              disabled={save.isPending}
              onClick={() => {
                save.reset();
                setForm(formOf(view.settings));
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
      <Toast toast={toast} onClose={close} />
    </>
  );
}

export function SettingsView() {
  const settings = useQuery(ownerInstanceOptions());
  const bot = useQuery(ownerBotOptions());
  const health = useQuery(ownerHealthOptions());
  const repositories = useQuery(ownerRepositoriesOptions());

  const settled = [settings, bot, health, repositories].every((q) => !q.isPending);
  const steps = settled
    ? setupSteps({
        bot: bot.data,
        settings: settings.data?.settings,
        health: health.data,
        repositories: repositories.data,
      })
    : null;

  return (
    <OwnerPage
      title="Settings"
      lead={
        health.data ? (
          <>
            <span className={health.data.ready ? "text-sev-live" : "text-sev-high"}>
              {health.data.ready ? "Running." : "Not ready."}
            </span>{" "}
            {health.data.ready
              ? `Cujo can take a run. Up ${Math.round(health.data.uptimeMs / 60_000)} min.`
              : describeHealth(health.data)}
          </>
        ) : undefined
      }
    >
      <div className="md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
        <nav aria-label="Settings" className="mb-8 md:mb-0">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 md:sticky md:top-22 md:flex-col md:gap-0">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block rounded-md py-1.5 text-sm text-fg-muted no-underline hover:text-fg md:px-2"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-12">
          {steps ? <SetupChecklist steps={steps} /> : null}
          {settings.error ? (
            <p className="text-sm text-sev-critical">
              The settings could not be loaded: {settings.error.message}
            </p>
          ) : settings.data ? (
            <Form view={settings.data} />
          ) : (
            <p className="text-sm text-fg-muted">Loading…</p>
          )}
          <AppSection bot={bot.data} failed={Boolean(bot.error)} />
          <DeliveriesSection bot={bot.data} />
        </div>
      </div>
    </OwnerPage>
  );
}
