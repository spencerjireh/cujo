import { randomUUID } from "node:crypto";
import { CUJO_API_URL } from "@/lib/api/client";
import { streamOutcome, streamStatus } from "@/lib/api/upstream";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";
import { headers } from "next/headers";

/**
 * The SSE proxy, separate from the JSON catch-all so nothing can accidentally
 * buffer it.
 *
 * The upstream ReadableStream is passed straight through: any per-chunk await
 * in this handler is where streaming latency comes from. `x-accel-buffering`
 * and an identity content-encoding stop an intermediate proxy from holding
 * chunks back, and `request.signal` propagates a browser `EventSource.close()`
 * all the way to `apps/cujo`, which drops its listener and keepalive timer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const incoming = await headers();
  const assertion = incoming.get("cf-access-jwt-assertion");
  const host = incoming.get("host");
  const ray = incoming.get("cf-ray") ?? `cujo-${randomUUID()}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${CUJO_API_URL()}/runs/${encodeURIComponent(id)}/events`, {
      headers: {
        accept: "text/event-stream",
        "cf-ray": ray,
        ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}),
        ...(host ? { "x-forwarded-host": host, "x-forwarded-proto": "https" } : {}),
      },
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    // A browser closing the stream aborts this fetch, which is the normal end
    // of every run page and not a failure worth a line.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    log.error("proxy.stream.failed", { run_id: id, mode: "operator", ray, ...errorFields(error) });
    return new Response(null, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const { event, level } = streamOutcome(upstream.status, upstream.ok, "operator");
    log[level](event, {
      run_id: id,
      mode: "operator",
      ray,
      http_status: upstream.status,
      ...(event === "proxy.stream.degraded" ? { reason: "stream_limit" } : {}),
    });
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
