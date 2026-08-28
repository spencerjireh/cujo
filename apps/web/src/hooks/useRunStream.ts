"use client";

import { runStreamUrl } from "@/lib/api/client";
import { runKeys } from "@/lib/api/keys";
import { runOptions, runsListOptions } from "@/lib/api/queries";
import { parseSnapshot, reduceList, reduceRun } from "@/lib/api/stream";
import { type RunStatus, isLive } from "@/lib/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Feeds the SSE snapshots into the Query cache so `useQuery` stays the single
 * read path for the run.
 *
 * The upstream contract shapes three decisions here: every event is a full
 * snapshot and may repeat, so the reducers return identity when nothing
 * changed; there is no terminal event, so the client closes when the status
 * stops being live; and there is no Last-Event-ID resume, so an errored stream
 * is closed and reconciled with one refetch rather than left to auto-reconnect
 * and replay from the start.
 */
export function useRunStream(id: string, status: RunStatus | undefined) {
  const queryClient = useQueryClient();
  const live = status !== undefined && isLive(status);

  useEffect(() => {
    if (!live) return;

    const source = new EventSource(runStreamUrl(id));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };

    source.addEventListener("run", (event) => {
      const snapshot = parseSnapshot((event as MessageEvent<string>).data);
      if (!snapshot) return;

      // The keys come from the shared queryOptions so the updater sees the
      // real cached type instead of `unknown`.
      queryClient.setQueryData(runOptions(id).queryKey, (previous) =>
        reduceRun(previous, snapshot),
      );
      queryClient.setQueryData(runsListOptions().queryKey, (previous) =>
        reduceList(previous, snapshot),
      );

      if (!isLive(snapshot.status)) close();
    });

    source.onerror = () => {
      close();
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(id) });
    };

    return close;
  }, [id, live, queryClient]);
}
