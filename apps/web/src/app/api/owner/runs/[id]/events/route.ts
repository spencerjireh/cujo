import { randomUUID } from "node:crypto";
import { CUJO_API_URL } from "@/lib/api/client";
import { sessionFromCookie } from "@/lib/api/owner";
import { streamOutcome, streamStatus } from "@/lib/api/upstream";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";
import { headers } from "next/headers";

/**
 * The owner plane's run stream (decision 159): the public stream's twin,
 * with the session cookie turned into the bearer the plane wants. Without a
 * session there is nothing to forward and the answer is 401 here, before
 * anything upstream is asked. Everything else is `api/public/runs/[id]/events`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ray = (await headers()).get("cf-ray") ?? `cujo-${randomUUID()}`;
  const session = sessionFromCookie(request.headers.get("cookie"));
  if (!session) return Response.json({ ok: false, error: "not signed in" }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${CUJO_API_URL()}/owner/runs/${encodeURIComponent(id)}/events`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${session}`,
        "cf-ray": ray,
      },
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    log.error("proxy.stream.failed", { run_id: id, ray, ...errorFields(error) });
    return new Response(null, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
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
