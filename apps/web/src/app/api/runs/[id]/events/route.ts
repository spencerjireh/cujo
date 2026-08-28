import { CUJO_API_URL } from "@/lib/api/client";
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

  const upstream = await fetch(`${CUJO_API_URL()}/runs/${encodeURIComponent(id)}/events`, {
    headers: {
      accept: "text/event-stream",
      ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}),
      ...(host ? { "x-forwarded-host": host, "x-forwarded-proto": "https" } : {}),
    },
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status === 200 ? 502 : upstream.status });
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
