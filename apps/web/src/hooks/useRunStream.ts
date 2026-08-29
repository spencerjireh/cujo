"use client";

import { runStreamUrl } from "@/lib/api/client";
import { runKeys } from "@/lib/api/keys";
import { runOptions, runsListOptions } from "@/lib/api/queries";
import { parseSnapshot, reduceList, reduceRun } from "@/lib/api/stream";
import { type RunStatus, isLive } from "@/lib/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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
 *
 * `streamFailed` exists because the board can refuse a stream outright when
 * the process is at its cap (decision 34). `EventSource` does not
 * reconnect after a non-200, so without this the page would simply stop
 * updating with nothing said — silent staleness, which is worse on a public
 * page than a visible failure. The caller says so and falls back to polling.
 */
export function useRunStream(id: string, status: RunStatus | undefined) {
  const queryClient = useQueryClient();
  const [streamFailed, setStreamFailed] = useState(false);
  const live = status !== undefined && isLive(status);

  useEffect(() => {
    if (!live) return;
    setStreamFailed(false);

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
      // Distinguishing "refused" from "dropped" is not possible here — the
      // status code never reaches the page — so both fall back the same way.
      setStreamFailed(true);
      close();
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(id) });
    };

    return close;
  }, [id, live, queryClient]);

  /**
   * The fallback. `runOptions` never polls because the stream is meant to be
   * the source of truth; once there is no stream, something has to be, or a
   * live run sits frozen until the visitor happens to reload. Slow on purpose —
   * this is the path taken when the server is already at its limit.
   */
  useEffect(() => {
    if (!live || !streamFailed) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(id) });
    }, 15_000);
    return () => clearInterval(timer);
  }, [id, live, queryClient, streamFailed]);

  return { streamFailed };
}
