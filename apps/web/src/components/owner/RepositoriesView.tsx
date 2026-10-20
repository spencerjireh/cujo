"use client";

import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import { Switch } from "@/components/ui/Switch";
import { Toast, useToast } from "@/components/ui/Toast";
import type { OwnedRepository } from "@/lib/api/owner-client";
import { ownerRepositoriesOptions, ownerRunsOptions } from "@/lib/api/queries";
import type { RunSummary } from "@/lib/api/types";
import { lastRunPerRepository, openBlocks } from "@/lib/owner/activity";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { OwnerPage } from "./OwnerPage";
import { useRepositorySwitch } from "./useRepositorySwitch";

/**
 * Every repository the App holds, and the one thing an owner decides per row
 * here: whether Cujo reviews it at all (decision 151). Beside the switch, the
 * newest run and how many pull requests are blocked, so the list answers
 * "which of these needs me" without opening each one (decision 175).
 *
 * A row the App has lost stays, dimmed and dated: its switch survives a
 * reinstall, and a list that dropped it would hide that the switch is still
 * set. Rows the App holds come first.
 */

function Row({
  repository,
  last,
  blocks,
  onToggle,
  busy,
}: {
  repository: OwnedRepository;
  last: RunSummary | undefined;
  blocks: number;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}) {
  const gone = repository.removedAt !== null;
  return (
    <tr className={`border-b border-line align-middle ${gone ? "text-fg-muted" : ""}`}>
      <td className="py-3 pr-4">
        <Link
          href={`/repos/${repository.repo}`}
          className="font-mono text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          {repository.displayName}
        </Link>
        <p className="mt-0.5 text-xs text-fg-muted">
          {repository.isPrivate ? "Private" : "Public"}
          {blocks > 0 ? (
            <span className="text-sev-critical sm:hidden">, {blocks} blocked</span>
          ) : null}
          {gone && repository.removedAt ? (
            <>
              , App removed <RelativeTime iso={repository.removedAt} />
            </>
          ) : null}
        </p>
      </td>
      <td className="hidden py-3 pr-4 sm:table-cell">
        {last ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={last.status} />
            <Link
              href={`/runs/${last.id}`}
              className="text-sm text-fg-muted underline decoration-line underline-offset-4 hover:text-fg"
            >
              <RelativeTime iso={last.created_at} />
            </Link>
          </span>
        ) : (
          <span className="text-sm text-fg-muted">No recent runs</span>
        )}
      </td>
      <td className="hidden py-3 pr-4 text-sm sm:table-cell">
        {blocks > 0 ? (
          <span className="text-sev-critical">{blocks} blocked</span>
        ) : (
          <span className="text-fg-muted">None</span>
        )}
      </td>
      <td className="py-3">
        {gone ? (
          <span className="text-sm text-fg-muted">Not installed</span>
        ) : (
          <Switch
            checked={repository.enabled}
            onChange={onToggle}
            disabled={busy}
            label={`Reviews on ${repository.displayName}`}
          />
        )}
      </td>
    </tr>
  );
}

export function RepositoriesView() {
  const list = useQuery(ownerRepositoriesOptions());
  const runs = useQuery(ownerRunsOptions());
  const { toast, show, close } = useToast();
  const toggle = useRepositorySwitch(show);

  const all = runs.data?.runs ?? [];
  const last = lastRunPerRepository(all);

  const body = list.error ? (
    <p className="text-sm text-sev-critical">Could not load repositories. Reload to try again.</p>
  ) : !list.data ? (
    <p className="text-sm text-fg-muted">Loading…</p>
  ) : list.data.length === 0 ? (
    <p className="max-w-[60ch] text-sm text-fg-muted">
      The App is not installed on any repository yet.
    </p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse sm:min-w-[40rem]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Repository
            </th>
            <th scope="col" className="hidden w-56 py-2 pr-4 font-medium sm:table-cell">
              Last run
            </th>
            <th scope="col" className="hidden w-32 py-2 pr-4 font-medium sm:table-cell">
              Open blocks
            </th>
            <th scope="col" className="w-24 py-2 font-medium sm:w-32">
              Reviews
            </th>
          </tr>
        </thead>
        <tbody>
          {[
            ...list.data.filter((r) => r.removedAt === null),
            ...list.data.filter((r) => r.removedAt !== null),
          ].map((repository) => (
            <Row
              key={repository.repo}
              repository={repository}
              last={last.get(repository.repo.toLowerCase())}
              blocks={openBlocks(all, repository.repo)}
              busy={toggle.isPending && toggle.variables?.repo === repository.repo}
              onToggle={(enabled) =>
                toggle.mutate({ repo: repository.repo, name: repository.displayName, enabled })
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <OwnerPage
      title="Repositories"
      lead="Turn reviews off and Cujo does nothing in that repository."
    >
      {body}
      {toggle.error ? (
        <p className="mt-3 text-sm text-sev-critical">
          The switch did not save: {toggle.error.message}
        </p>
      ) : null}
      <Toast toast={toast} onClose={close} />
    </OwnerPage>
  );
}
