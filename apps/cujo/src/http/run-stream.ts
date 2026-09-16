/**
 * One run's live stream, as a plane serves it.
 *
 * Extracted from the public plane so the owner plane (decision 159) streams a
 * private run through the same code: the same keepalive, the same visibility
 * re-check on every frame, the same teardown. What differs per plane is what
 * "visible" means, how many streams it holds, and the lines it logs.
 */
import type { Fields, Logger } from "@cujo/log";
import type { Context, Input } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunView, Runner } from "../review/runner.service";
import { serializePublicRun } from "./public/serialize";
import type { StreamLimit } from "./public/stream-limit";
import type { RequestEnv } from "./request-log";

export interface RunStreamDeps {
  runner: Pick<Runner, "changes">;
  /** The run as this plane may show it now, or null once it may not. */
  visible: (id: string) => RunView | null;
  /** Whether a fresh view is still one this plane may send. */
  admits: (view: RunView) => boolean;
  limit: StreamLimit;
  limitSize: number;
  /** Whose stream this is, which picks the lines it logs. */
  plane: "public" | "owner";
}

/** How long a stream may sit between keepalives, in milliseconds. */
const KEEPALIVE_MS = 25_000;

type Line = (log: Logger, fields: Fields) => void;

/**
 * The three lines, per plane, each a literal at its call: the vocabulary
 * test reads call sites, and a name passed through a table is a name it
 * would count as never emitted.
 */
const LINES: Record<RunStreamDeps["plane"], { rejected: Line; opened: Line; closed: Line }> = {
  public: {
    rejected: (log, fields) => log.warn("public.stream.rejected", fields),
    opened: (log, fields) => log.debug("public.stream.opened", fields),
    closed: (log, fields) => log.debug("public.stream.closed", fields),
  },
  owner: {
    rejected: (log, fields) => log.warn("owner.stream.rejected", fields),
    opened: (log, fields) => log.debug("owner.stream.opened", fields),
    closed: (log, fields) => log.debug("owner.stream.closed", fields),
  },
};

export function streamRun<E extends RequestEnv, P extends string, I extends Input>(
  c: Context<E, P, I>,
  id: string,
  view: RunView,
  deps: RunStreamDeps,
) {
  const { limit } = deps;
  const lines = LINES[deps.plane];
  // 503 and not 429: this visitor sent one request, and the limit is this
  // process's capacity. 429 is the edge's word for too many requests from one
  // address, so keeping them apart says which bound bit.
  if (!limit.acquire()) {
    // Before the stream opens, so `release()` is deliberately not called
    // here: nothing was acquired. `warn` rather than `debug` — the cap being
    // reached is the board shedding load, which an operator should see even
    // though the visitor recovers by polling.
    lines.rejected(c.get("log"), {
      run_id: id,
      active: limit.active(),
      limit: deps.limitSize,
      reason: "limit",
    });
    c.header("retry-after", "30");
    return c.json({ ok: false, error: "too many streams" }, 503);
  }
  const log = c.get("log");
  return streamSSE(c, async (stream) => {
    // `debug`, both of these: at the cap this is 200 concurrent streams, and
    // the frames themselves are never logged at all.
    lines.opened(log, { run_id: id, active: limit.active() });
    let seq = 0;
    let closedBecause: "went_private" | "aborted" = "aborted";
    // Resolved by whichever end closes first. `stream.close()` is a
    // server-initiated close and does *not* fire `onAbort`, which fires only
    // when the client goes away — so parking on `onAbort` alone left the
    // handler suspended forever on a visibility flip, and the `finally`
    // below never ran: the listener stayed subscribed, the keepalive kept
    // ticking, and `limit.release()` was never called. Every repo that went
    // private while somebody was watching cost the public plane one of its
    // 200 slots, permanently.
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const closeBecausePrivate = () => {
      closedBecause = "went_private";
      void stream.close();
      finish();
    };
    const send = (v: RunView) =>
      stream.writeSSE({
        event: "run",
        id: String(seq++),
        data: JSON.stringify(serializePublicRun(v)),
      });
    const listener = (v: RunView) => {
      // A repo can go private mid-stream, and that flip is a store write
      // that emits nothing of its own, so re-check on every frame.
      if (deps.admits(v)) void send(v);
      else closeBecausePrivate();
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
      await send(deps.visible(id) ?? view);
      keepalive = setInterval(() => {
        // The keepalive doubles as the poll that catches a flip on a run
        // that is emitting nothing, so exposure is bounded by this interval.
        if (deps.visible(id)) void stream.writeSSE({ event: "ping", data: "" });
        else closeBecausePrivate();
      }, KEEPALIVE_MS);
      stream.onAbort(() => finish());
      await done;
    } finally {
      if (keepalive) clearInterval(keepalive);
      deps.runner.changes.off(id, listener);
      limit.release();
      // `went_private` is the one worth telling apart: the visitor did not
      // leave, the repo stopped being public underneath them.
      lines.closed(log, {
        run_id: id,
        active: limit.active(),
        reason: closedBecause,
      });
    }
  });
}
