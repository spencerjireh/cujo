import { randomUUID } from "node:crypto";
import { CUJO_API_URL } from "@/lib/api/client";
import { refusalFields } from "@/lib/api/upstream";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";
import { headers } from "next/headers";

/**
 * The JSON proxy to `apps/cujo`.
 *
 * It exists so the API is same-origin with the UI, which is what lets the page
 * and its data share an origin without CORS. It also means `apps/cujo` needs no
 * published route at all: it is reached over the compose network and nothing
 * else.
 *
 * It forwards only `/public/*`, and no credential, because there is nothing
 * else to reach and none to send (decision 57). `apps/cujo` answers 404 outside
 * that prefix anyway, so this is the second refusal rather than the first — the
 * same defence in depth decision 33 relied on when the origin turned out to be
 * reachable by IP.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(request: Request, path: string[]): Promise<Response> {
  const incoming = await headers();
  // Generated when Cloudflare did not send one, so a local run still joins its
  // two halves. `apps/cujo` trusts `cf-ray` from the edge and re-derives from
  // it, so forwarding the same value is what makes one query span both apps.
  const ray = incoming.get("cf-ray") ?? `cujo-${randomUUID()}`;

  // The SSE stream has its own route; a buffered passthrough here would break it.
  if (path[path.length - 1] === "events") {
    log.warn("proxy.rejected", { ...refusalFields(path, "events_path"), ray });
    return Response.json({ ok: false, error: "use /api/public/runs/:id/events" }, { status: 404 });
  }
  // Unconditional now, where it used to apply only on the public hostname: the
  // board is the only thing there is to reach.
  if (path[0] !== "public") {
    log.warn("proxy.rejected", { ...refusalFields(path, "public_plane"), ray });
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const contentType = request.headers.get("content-type");

  const target = new URL(`${CUJO_API_URL()}/${path.map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(contentType ? { "content-type": contentType } : {}),
        "cf-ray": ray,
      },
      body:
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch (error) {
    // Behaviour change, and the point of this handler's share of decision 37:
    // an unreachable `cujo` used to throw here and become an unhandled Next
    // 500 with nothing on the box to explain it. It is now a deliberate 502
    // with a line naming the path and the ray.
    log.error("proxy.upstream.failed", {
      path: `/${path.join("/")}`,
      ray,
      ...errorFields(error),
    });
    return Response.json({ ok: false, error: "cujo is unreachable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * `GET` only, because anything not exported here is a 405 from Next and there
 * is no other route to reach `apps/cujo` with: this app is what the hostname
 * resolves to. The write verbs existed for the Discord admin API, which went
 * with the operator plane (decision 57), and the board has no write route at
 * all — so the absence is the point rather than an omission.
 */
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}
