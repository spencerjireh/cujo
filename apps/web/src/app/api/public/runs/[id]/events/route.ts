import { CUJO_API_URL } from "@/lib/api/client";

/**
 * The public run stream, proxied unbuffered to `apps/cujo`'s `/public` plane.
 *
 * A separate route rather than a `?mode=` parameter on the operator one: a
 * query string is something the browser controls, and a page served on the
 * public hostname must not be able to ask for the gated stream. No Access
 * assertion is forwarded, because there is none to forward and the upstream
 * route wants none.
 *
 * `apps/cujo` may answer 503 when it is already holding its cap of public
 * streams (decision 34). That status is passed through rather than smoothed
 * over; `useRunStream` shows the visitor that live updates stopped and falls
 * back to polling.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const upstream = await fetch(`${CUJO_API_URL()}/public/runs/${encodeURIComponent(id)}/events`, {
    headers: { accept: "text/event-stream" },
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
