"use client";

import { runsListOptions } from "@/lib/api/queries";
import { useQuery } from "@tanstack/react-query";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const { data, error, isPending } = useQuery(runsListOptions());

  if (error) {
    return (
      <p className="text-sm text-sev-critical">
        The run list could not be loaded. Check that the Cujo API is reachable, then reload.
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl">Runs</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Every pull request Cujo has executed, newest first.
      </p>
      {isPending ? (
        <p className="text-sm text-fg-muted">Loading runs…</p>
      ) : (
        <RunsTable runs={data?.runs ?? []} />
      )}
    </div>
  );
}
