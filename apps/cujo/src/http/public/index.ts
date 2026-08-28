/**
 * The public plane: the run board as an anonymous visitor sees it (decision 34).
 *
 * No Access check, by construction rather than by omission — `router.ts` mounts
 * this group on its own Hono instance, beside the gated one rather than under
 * it, so the operator gate's `app.use("*")` cannot compose with these handlers.
 * There is no verifier in `PublicDeps` and no route here writes anything.
 *
 * Two conditions guard every response: the run must exist, and its repo must
 * have been public. Both are answered by `visible()` so there is one place to
 * get them wrong, and the list filters in SQL rather than here.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunView, Runner } from "../../review/runner.service";
import type { RunStore } from "../../store";
import type { RequestEnv } from "../request-log";
import { serializePublicRun, serializePublicSummary } from "./serialize";
import { type StreamLimit, createStreamLimit } from "./stream-limit";

export interface PublicDeps {
  runs: RunStore;
  runner: Runner;
  /** Concurrent public streams allowed at once. */
  streamLimit: number;
}

/** How long a public stream may sit between keepalives, in milliseconds. */
const KEEPALIVE_MS = 25_000;

export function publicRoutes(deps: PublicDeps): { app: Hono<RequestEnv>; limit: StreamLimit } {
  const app = new Hono<RequestEnv>();
  const limit = createStreamLimit(deps.streamLimit);

  /**
   * A run nobody may see is 404, not 403: the public plane does not confirm
   * that a private repo has runs at all.
   */
  const visible = (id: string): RunView | null => {
    const view = deps.runner.view(id);
    return view?.run.isPublic ? view : null;
  };

  app.get("/runs", (c) => {
    return c.json({ runs: deps.runs.listPublicRuns().map(serializePublicSummary) });
  });

  app.get("/runs/:id", (c) => {
    const view = visible(c.req.param("id"));
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return c.json(serializePublicRun(view));
  });

  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const view = visible(id);
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    // 503 and not 429: this visitor sent one request, and the limit is this
    // process's capacity. 429 is the edge's word for too many requests from one
    // address, so keeping them apart says which bound bit.
    if (!limit.acquire()) {
      // Before the stream opens, so `release()` is deliberately not called
      // here: nothing was acquired. `warn` rather than `debug` — the cap being
      // reached is the board shedding load, which an operator should see even
      // though the visitor recovers by polling.
      c.get("log").warn("public.stream.rejected", {
        run_id: id,
        active: limit.active(),
        limit: deps.streamLimit,
        reason: "limit",
      });
      c.header("retry-after", "30");
      return c.json({ ok: false, error: "too many public streams" }, 503);
    }
    const log = c.get("log");
    return streamSSE(c, async (stream) => {
      // `debug`, both of these: at the cap this is 200 concurrent streams, and
      // the frames themselves are never logged at all.
      log.debug("public.stream.opened", { run_id: id, active: limit.active() });
      let seq = 0;
      let closedBecause: "went_private" | "aborted" = "aborted";
      const send = (v: RunView) =>
        stream.writeSSE({
          event: "run",
          id: String(seq++),
          data: JSON.stringify(serializePublicRun(v)),
        });
      const listener = (v: RunView) => {
        // A repo can go private mid-stream, and that flip is a store write
        // that emits nothing of its own, so re-check on every frame.
        if (v.run.isPublic) void send(v);
        else {
          closedBecause = "went_private";
          void stream.close();
        }
      };
      let keepalive: ReturnType<typeof setInterval> | undefined;

      // Listen first, then read: an update between the two is delivered twice
      // at worst, never lost. Subscribed outside the try so the finally below
      // is guaranteed to be the one place it is torn down — if the first
      // writeSSE rejects, an unsubscribe that lived at the end of the happy
      // path would never run, and the listener would go on writing to a dead
      // stream on every later run update while holding it from collection.
      deps.runner.changes.on(id, listener);
      try {
        await send(visible(id) ?? view);
        keepalive = setInterval(() => {
          // The keepalive doubles as the poll that catches a flip on a run
          // that is emitting nothing, so exposure is bounded by this interval.
          if (deps.runs.getRun(id)?.isPublic) void stream.writeSSE({ event: "ping", data: "" });
          else {
            closedBecause = "went_private";
            void stream.close();
          }
        }, KEEPALIVE_MS);
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
        });
      } finally {
        if (keepalive) clearInterval(keepalive);
        deps.runner.changes.off(id, listener);
        limit.release();
        // `went_private` is the one worth telling apart: the visitor did not
        // leave, the repo stopped being public underneath them.
        log.debug("public.stream.closed", {
          run_id: id,
          active: limit.active(),
          reason: closedBecause,
        });
      }
    });
  });

  // The public surface is exactly the three routes above. Without this the
  // fall-through would reach the gated plane and answer 401, so the failure
  // direction is closed either way; this makes it enumerable.
  app.all("*", (c) => c.json({ ok: false, error: "not found" }, 404));

  return { app, limit };
}
