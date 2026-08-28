import { queryOptions } from "@tanstack/react-query";
import { fetchRun, fetchRuns } from "./client";
import { runKeys } from "./keys";
import { type RunList, isLive } from "./types";

/**
 * There is no stream for the list, so it polls: often while anything is live,
 * rarely when the board is quiet, and never while the tab is backgrounded.
 */
export function runsListOptions() {
  return queryOptions({
    queryKey: runKeys.list(),
    queryFn: ({ signal }) => fetchRuns(signal),
    refetchInterval: (query) => {
      const data = query.state.data as RunList | undefined;
      const anyLive = (data?.runs ?? []).some((run) => isLive(run.status));
      return anyLive ? 5_000 : 30_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

/**
 * The detail query never polls: while the run is live the SSE stream is the
 * source of truth and writes straight into this cache entry, and once it is
 * terminal nothing can change it.
 */
export function runOptions(id: string) {
  return queryOptions({
    queryKey: runKeys.detail(id),
    queryFn: ({ signal }) => fetchRun(id, signal),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
