"use client";

import { RelativeTime } from "@/components/RelativeTime";
import {
  type OwnedRepository,
  fetchRepositories,
  setRepositoryEnabled,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

/**
 * Every repository the App holds, and the one thing an owner decides per row
 * here: whether Cujo works on it at all (decision 151). The rest of a
 * repository's settings are on its own page, which the name links to.
 *
 * A row the App has lost stays, dimmed and dated: its switch survives a
 * reinstall, and a list that dropped it would hide that the switch is still
 * set. Rows the App holds come first.
 */
function Row({
  repository,
  onToggle,
  busy,
}: { repository: OwnedRepository; onToggle: () => void; busy: boolean }) {
  const gone = repository.removedAt !== null;
  return (
    <li
      className={`grid grid-cols-[1fr_auto] items-center gap-4 border-t border-line py-3 md:grid-cols-[1fr_8rem_9rem_auto] ${gone ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <Link
          href={`/repos/${repository.repo}`}
          className="font-mono text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          {repository.displayName}
        </Link>
        <p className="mt-0.5 font-mono text-xs text-fg-muted md:hidden">
          {repository.isPrivate ? "private" : "public"}
          {gone ? " · not installed" : ""}
        </p>
      </div>
      <span className="hidden font-mono text-xs text-fg-muted md:block">
        {repository.isPrivate ? "private" : "public"}
      </span>
      <span className="hidden font-mono text-xs text-fg-muted md:block">
        {gone && repository.removedAt ? (
          <>
            not installed since <RelativeTime iso={repository.removedAt} />
          </>
        ) : (
          <>
            installed <RelativeTime iso={repository.addedAt} />
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={repository.enabled}
        className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors disabled:opacity-50 ${
          repository.enabled
            ? "border-sev-live/40 bg-sev-live-bg text-sev-live"
            : "border-line text-fg-muted hover:border-fg-muted hover:text-fg"
        }`}
      >
        {repository.enabled ? "reviewing" : "off"}
      </button>
    </li>
  );
}

export function RepositoriesView() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ownerKeys.repositories(),
    queryFn: ({ signal }) => fetchRepositories(undefined, signal),
    staleTime: 30_000,
  });
  const toggle = useMutation({
    mutationFn: ({ repo, enabled }: { repo: string; enabled: boolean }) =>
      setRepositoryEnabled(repo, enabled),
    onSuccess: () => client.invalidateQueries({ queryKey: ownerKeys.repositories() }),
  });

  if (list.error) {
    return (
      <p className="text-sm text-sev-critical">
        The repositories could not be loaded. Reload to try again.
      </p>
    );
  }
  if (!list.data) return <p className="text-sm text-fg-muted">Loading…</p>;

  const held = list.data.filter((r) => r.removedAt === null);
  const gone = list.data.filter((r) => r.removedAt !== null);
  const rows = [...held, ...gone];

  return (
    <section aria-label="Repositories">
      <h1 className="text-2xl">Repositories</h1>
      <p className="mt-2 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        What the App is installed on. Off means Cujo does nothing on that repository: no review, no
        reply, no check. Open one for how it is reviewed.
      </p>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-fg-muted">
          The App is not installed on any repository yet, or the registry has not synced. Install it
          on one and this fills in.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col border-b border-line">
          {rows.map((repository) => (
            <Row
              key={repository.repo}
              repository={repository}
              busy={toggle.isPending && toggle.variables?.repo === repository.repo}
              onToggle={() =>
                toggle.mutate({ repo: repository.repo, enabled: !repository.enabled })
              }
            />
          ))}
        </ul>
      )}
      {toggle.error ? (
        <p className="mt-3 font-mono text-xs text-sev-critical">
          The switch did not save: {toggle.error.message}
        </p>
      ) : null}
    </section>
  );
}
