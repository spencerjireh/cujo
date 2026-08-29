import { randomUUID } from "node:crypto";
import { CUJO_API_URL } from "@/lib/api/client";
import { streamOutcome, streamStatus } from "@/lib/api/upstream";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";
import { headers } from "next/headers";

/**
 * The run stream, proxied unbuffered to `apps/cujo`'s `/public` plane.
 *
 * A fixed path rather than a `?mode=` parameter: a query string is something
 * the browser controls, and this stayed a fixed path after decision 54 deleted
 * the gated stream it used to be told apart from, because the rule is worth
 * keeping whether or not there is a second thing to reach. No credential is
 * forwarded — there is none, and the upstream route wants none.
 *
 * `apps/cujo` may answer 503 when it is already holding its cap of streams
 * (decision 34). That status is passed through rather than smoothed over;
 * `useRunStream` shows the visitor that live updates stopped and falls back to
 * polling.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // No credential and no forwarded host — there is none to forward — but the
  // ray still travels, so a visitor's stream and the run it is watching share
  // one id in the log.
  const ray = (await headers()).get("cf-ray") ?? `cujo-${randomUUID()}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${CUJO_API_URL()}/public/runs/${encodeURIComponent(id)}/events`, {
      headers: { accept: "text/event-stream", "cf-ray": ray },
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    // A browser closing the stream aborts this fetch, which is the normal end
    // of every run page and not a failure worth a line.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    log.error("proxy.stream.failed", { run_id: id, ray, ...errorFields(error) });
    return new Response(null, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // Written as two branches with the names spelled out, rather than
    // `log[level](event, …)`. The event name is the vocabulary's whole
    // enforcement surface: the guard test scans the source for these literals
    // and fails on a declared name nothing emits, and a computed call is
    // invisible to it — this one was, until the scan said so.
    const fields = { run_id: id, ray, http_status: upstream.status };
    if (streamOutcome(upstream.status, upstream.ok).event === "proxy.stream.degraded") {
      log.warn("proxy.stream.degraded", { ...fields, reason: "stream_limit" });
    } else {
      log.error("proxy.stream.failed", fields);
    }
    return new Response(null, { status: streamStatus(upstream.status) });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "content-encoding": "identity",
    },
  });
}
