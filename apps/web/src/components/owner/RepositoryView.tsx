"use client";

import { Switch } from "@/components/ui/Switch";
import { Toast, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import {
  type RepositorySettingsView,
  type ReviewMode,
  fetchRepositorySettings,
  saveRepositorySettings,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { ownerRepositoriesOptions, ownerRunsOptions } from "@/lib/api/queries";
import {
  MODE_DETAILS,
  MODE_LABELS,
  describeInstructions,
  describeMode,
  effectiveMode,
} from "@/lib/owner/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { OwnerPage, OwnerSection, PRIMARY_BUTTON } from "./OwnerPage";
import { RunTable } from "./RunTable";
import { useRepositorySwitch } from "./useRepositorySwitch";

/**
 * One repository (decisions 155, 175). Its runs first, because that is what an
 * owner opens a repository for most; its review settings a tab away. The
 * header says which mode the next run uses and where that comes from, so an
 * owner is not surprised by a file they forgot. A value the repository's own
 * file sets is shown, and the control for it is disabled with a note, rather
 * than drawn as a choice that does nothing.
 */

type Tab = "runs" | "settings";

function ModeControl({
  view,
  onSave,
  busy,
}: {
  view: RepositorySettingsView;
  onSave: (mode: ReviewMode | null) => void;
  busy: boolean;
}) {
  const fileWins = view.effective.mode.source === "file";
  const name = useId();
  const choices: { value: ReviewMode | null; label: string; detail: string }[] = [
    {
      value: null,
      label: `Use the default (${MODE_LABELS[view.instance.mode]})`,
      detail: "Set on the Settings page.",
    },
    { value: "sandbox", label: MODE_LABELS.sandbox, detail: MODE_DETAILS.sandbox },
    { value: "diff", label: MODE_LABELS.diff, detail: MODE_DETAILS.diff },
  ];
  return (
    <OwnerSection id="mode" title="Review mode" lead={describeMode(view)}>
      <fieldset disabled={busy || fileWins} className="flex max-w-[44rem] flex-col gap-2">
        <legend className="sr-only">Review mode</legend>
        {choices.map((choice) => {
          const active = view.board.mode === choice.value;
          return (
            <label
              key={choice.label}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                active ? "border-accent bg-bg-raised" : "border-line hover:border-fg-muted"
              } ${fileWins ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={name}
                checked={active}
                onChange={() => onSave(choice.value)}
                className="mt-1 accent-[var(--accent-fill)]"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{choice.label}</span>
                <span className="block text-sm text-fg-muted">{choice.detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {fileWins && view.file.mode ? (
        <p className="mt-3 text-sm text-fg-muted">
          To choose here, remove <code className="font-mono text-xs">mode</code> from the
          repository&rsquo;s <code className="font-mono text-xs">.cujo.yml</code>.
        </p>
      ) : null}
    </OwnerSection>
  );
}

function Instructions({
  view,
  onSave,
  busy,
}: {
  view: RepositorySettingsView;
  onSave: (text: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(view.board.instructions ?? "");
  useEffect(() => setDraft(view.board.instructions ?? ""), [view.board.instructions]);
  const fileWins = view.effective.instructions?.source === "file";
  const dirty = draft !== (view.board.instructions ?? "");
  return (
    <OwnerSection id="instructions" title="Instructions" lead={describeInstructions(view)}>
      {fileWins && view.effective.instructions ? (
        <div className="mb-4 max-w-[80ch]">
          <p className="mb-1 text-xs text-fg-muted">
            From <span className="font-mono">{view.file.path}</span>
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg-raised p-3 font-mono text-xs text-fg-muted">
            {view.effective.instructions.text}
          </pre>
        </div>
      ) : null}
      <label className="block max-w-[80ch]">
        <span className="text-sm text-fg">
          {fileWins ? "Set here, used if the file is removed" : "What reviews should weigh"}
        </span>
        <span className="mt-0.5 block text-xs text-fg-muted">
          For example: what matters, what to skip.
        </span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
          maxLength={16_000}
          spellCheck={false}
          className="mt-2 block w-full rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onSave(draft)}
          className={PRIMARY_BUTTON}
        >
          Save instructions
        </button>
        {dirty ? <span className="text-sm text-fg-muted">Unsaved changes</span> : null}
      </div>
    </OwnerSection>
  );
}

function Runs({ repo }: { repo: string }) {
  // The owner's list, so a private repository's runs are here too (decision 159).
  const list = useQuery(ownerRunsOptions());
  const runs = (list.data?.runs ?? []).filter(
    (run) => run.repo.toLowerCase() === repo.toLowerCase(),
  );
  if (list.isPending) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (list.error) {
    return <p className="text-sm text-sev-critical">Could not load runs. Reload to try again.</p>;
  }
  if (runs.length === 0) {
    return <p className="max-w-[60ch] text-sm text-fg-muted">No recent runs.</p>;
  }
  return <RunTable runs={runs.slice(0, 30)} showRepository={false} />;
}

function Tabs({ repo, tab }: { repo: string; tab: Tab }) {
  const items: { id: Tab; label: string; href: string }[] = [
    { id: "runs", label: "Runs", href: `/repos/${repo}` },
    { id: "settings", label: "Review settings", href: `/repos/${repo}?tab=settings` },
  ];
  return (
    <nav aria-label="Repository" className="mb-8 flex gap-1 border-b border-line">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={tab === item.id ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm no-underline transition-colors ${
            tab === item.id
              ? "border-accent-fill font-medium text-fg"
              : "border-transparent text-fg-muted hover:text-fg"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function RepositoryView({ repo }: { repo: string }) {
  const client = useQueryClient();
  const tab: Tab = useSearchParams()?.get("tab") === "settings" ? "settings" : "runs";
  const settings = useQuery({
    queryKey: ownerKeys.settings(repo),
    queryFn: ({ signal }) => fetchRepositorySettings(repo, undefined, signal),
    staleTime: 30_000,
  });
  const repositories = useQuery(ownerRepositoriesOptions());
  const save = useMutation({
    mutationFn: (patch: { mode?: ReviewMode | null; instructions?: string | null }) =>
      saveRepositorySettings(repo, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: ownerKeys.settings(repo) }),
  });
  const { toast, show, close } = useToast();
  const toggle = useRepositorySwitch(show);
  const owned = repositories.data?.find((r) => r.repo.toLowerCase() === repo.toLowerCase());

  if (settings.error) {
    const missing = settings.error instanceof ApiError && settings.error.status === 404;
    return (
      <OwnerPage title={repo}>
        <p className={`max-w-[60ch] text-sm ${missing ? "text-fg-muted" : "text-sev-critical"}`}>
          {missing
            ? "Unknown repository. Install the App on it first."
            : `Could not load settings: ${settings.error.message}`}
        </p>
        <Link href="/repos" className="mt-4 inline-block text-sm text-accent hover:underline">
          All repositories
        </Link>
      </OwnerPage>
    );
  }

  return (
    <OwnerPage
      title={<span className="font-mono text-2xl tracking-normal">{repo}</span>}
      lead={
        settings.data ? (
          <>
            Next run: <span className="text-fg">{effectiveMode(settings.data)}</span>
          </>
        ) : undefined
      }
      actions={
        owned && owned.removedAt === null ? (
          <Switch
            checked={owned.enabled}
            onChange={(enabled) =>
              toggle.mutate({ repo: owned.repo, name: owned.displayName, enabled })
            }
            disabled={toggle.isPending}
            label="Reviews"
            showLabel
          />
        ) : undefined
      }
    >
      <Tabs repo={repo} tab={tab} />
      {tab === "runs" ? (
        <Runs repo={repo} />
      ) : !settings.data ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-10">
          <ModeControl
            view={settings.data}
            busy={save.isPending}
            onSave={(mode) => save.mutate({ mode })}
          />
          <Instructions
            view={settings.data}
            busy={save.isPending}
            onSave={(text) => save.mutate({ instructions: text })}
          />
          {save.error ? (
            <p className="-mt-6 text-sm text-sev-critical">Not saved: {save.error.message}</p>
          ) : null}
        </div>
      )}
      {toggle.error ? (
        <p className="mt-3 text-sm text-sev-critical">
          The switch did not save: {toggle.error.message}
        </p>
      ) : null}
      <Toast toast={toast} onClose={close} />
    </OwnerPage>
  );
}
