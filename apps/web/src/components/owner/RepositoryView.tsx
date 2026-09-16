"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { ApiError } from "@/lib/api/client";
import {
  type RepositorySettingsView,
  type ReviewMode,
  fetchRepositorySettings,
  saveRepositorySettings,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { ownerRunsOptions } from "@/lib/api/queries";
import { duration, shortSha } from "@/lib/format";
import { MODE_LABELS, describeInstructions, describeMode } from "@/lib/owner/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * One repository: how it is reviewed, in the three layers decision 155
 * names, and its runs. The page shows every layer and says which one the
 * next run will use, so an owner is not surprised by a file they forgot;
 * the board's values are the only ones editable here, and a file that
 * speaks is shown beside them, read-only.
 */

const CHOICES: { value: ReviewMode | null; label: string; detail: string }[] = [
  { value: null, label: "follow the instance", detail: "whatever the instance's default is" },
  { value: "sandbox", label: MODE_LABELS.sandbox, detail: "clone, install, test, boot, detonate" },
  {
    value: "diff",
    label: MODE_LABELS.diff,
    detail: "read the diff against the standards, no sandbox",
  },
];

function ModeControl({
  view,
  onSave,
  busy,
}: { view: RepositorySettingsView; onSave: (mode: ReviewMode | null) => void; busy: boolean }) {
  return (
    <div>
      <h2 className="text-lg">Review</h2>
      <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        {describeMode(view)}
      </p>
      <div
        role="radiogroup"
        aria-label="Review mode on the board"
        className="mt-3 flex flex-wrap gap-2"
      >
        {CHOICES.map((choice) => {
          const active = view.board.mode === choice.value;
          return (
            <button
              key={choice.label}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => onSave(choice.value)}
              title={choice.detail}
              className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors disabled:opacity-50 ${
                active
                  ? "border-accent text-accent"
                  : "border-line text-fg-muted hover:border-fg-muted hover:text-fg"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      {view.file.mode ? (
        <p className="mt-2 font-mono text-xs text-fg-muted">
          .cujo.yml says <span className="text-fg">{MODE_LABELS[view.file.mode]}</span>
        </p>
      ) : null}
    </div>
  );
}

function Instructions({
  view,
  onSave,
  busy,
}: { view: RepositorySettingsView; onSave: (text: string) => void; busy: boolean }) {
  const [draft, setDraft] = useState(view.board.instructions ?? "");
  useEffect(() => setDraft(view.board.instructions ?? ""), [view.board.instructions]);
  const fileWins = view.effective.instructions?.source === "file";
  const dirty = draft !== (view.board.instructions ?? "");
  return (
    <div>
      <h2 className="text-lg">Instructions</h2>
      <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        {describeInstructions(view)}
      </p>
      {fileWins && view.effective.instructions ? (
        <pre className="mt-3 max-h-80 max-w-[80ch] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg-raised p-3 font-mono text-xs text-fg-muted">
          {view.effective.instructions.text}
        </pre>
      ) : null}
      <label className="mt-3 block">
        <span className="font-mono text-xs text-fg-muted">
          {fileWins
            ? "On the board, for when the file goes away"
            : "What to weigh, what to leave alone, which paths not to comment on"}
        </span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
          maxLength={16_000}
          spellCheck={false}
          className="mt-1 block w-full max-w-[80ch] rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onSave(draft)}
          className="rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Save instructions
        </button>
        {dirty ? <span className="font-mono text-xs text-fg-muted">unsaved</span> : null}
      </div>
    </div>
  );
}

function Runs({ repo }: { repo: string }) {
  // The owner's list, so a private repository's runs are here too (decision 159).
  const list = useQuery(ownerRunsOptions());
  const runs = (list.data?.runs ?? []).filter(
    (run) => run.repo.toLowerCase() === repo.toLowerCase(),
  );
  return (
    <div>
      <h2 className="text-lg">Runs</h2>
      <p className="mt-1 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        The newest runs on this repository, a private one&rsquo;s included.
      </p>
      {list.isPending ? (
        <p className="mt-3 text-sm text-fg-muted">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No runs on the board for this repository.</p>
      ) : (
        <ul className="mt-3 flex flex-col border-b border-line">
          {runs.slice(0, 20).map((run) => (
            <li
              key={run.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-line py-2 md:grid-cols-[1fr_6rem_5rem_auto]"
            >
              <Link
                href={`/runs/${run.id}`}
                className="min-w-0 truncate font-mono text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
              >
                #{run.pr_number} {run.pr_title ?? ""}
              </Link>
              <span className="hidden font-mono text-xs text-fg-muted md:block">
                {shortSha(run.head_sha)}
              </span>
              <span className="hidden font-mono text-xs text-fg-muted md:block">
                {duration(run.created_at, run.updated_at) ?? ""}
              </span>
              <StatusBadge status={run.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RepositoryView({ repo }: { repo: string }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ownerKeys.settings(repo),
    queryFn: ({ signal }) => fetchRepositorySettings(repo, undefined, signal),
    staleTime: 30_000,
  });
  const save = useMutation({
    mutationFn: (patch: { mode?: ReviewMode | null; instructions?: string | null }) =>
      saveRepositorySettings(repo, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: ownerKeys.settings(repo) }),
  });

  if (settings.error) {
    const missing = settings.error instanceof ApiError && settings.error.status === 404;
    return (
      <section>
        <p className="font-mono text-xs text-fg-muted">
          <Link href="/repos" className="hover:text-fg">
            ← repositories
          </Link>
        </p>
        <h1 className="mt-2 text-2xl">{repo}</h1>
        <p
          className={`mt-3 max-w-[60ch] text-sm ${missing ? "text-fg-muted" : "text-sev-critical"}`}
        >
          {missing
            ? "Cujo has not heard of this repository. It appears here once the App is installed on it."
            : `This repository's settings could not be loaded: ${settings.error.message}`}
        </p>
      </section>
    );
  }
  if (!settings.data) return <p className="text-sm text-fg-muted">Loading…</p>;

  return (
    <article className="flex flex-col gap-10">
      <header>
        <p className="font-mono text-xs text-fg-muted">
          <Link href="/repos" className="hover:text-fg">
            ← repositories
          </Link>
        </p>
        <h1 className="mt-2 text-2xl">{repo}</h1>
      </header>
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
        <p className="-mt-6 font-mono text-xs text-sev-critical">Not saved: {save.error.message}</p>
      ) : null}
      <Runs repo={repo} />
    </article>
  );
}
