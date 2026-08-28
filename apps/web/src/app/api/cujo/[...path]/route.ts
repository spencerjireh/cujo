import { randomUUID } from "node:crypto";
import { CUJO_API_URL } from "@/lib/api/client";
import { modeForHost, publicHost } from "@/lib/api/mode";
import { refusalFields } from "@/lib/api/upstream";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";
import { headers } from "next/headers";

/**
 * The JSON proxy to `apps/cujo`.
 *
 * It exists so the API is same-origin with the UI: Cloudflare Access injects
 * `Cf-Access-Jwt-Assertion` at the edge and browser code cannot forge it, so a
 * cross-origin API would need a second Access application and cross-site cookie
 * handling. Keeping it here also means `apps/cujo` needs no public route at all.
 *
 * `apps/cujo` still verifies the assertion itself, so this forwards rather than
 * terminates the check.
 *
 * On the public hostname it forwards only `/public/*` and forwards no
 * assertion. `apps/cujo` would refuse a gated path anyway, so this is the
 * second gate rather than the first — the same defence in depth decision 33
 * relied on when the origin turned out to be reachable by IP.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(request: Request, path: string[]): Promise<Response> {
  const incoming = await headers();
  const host = incoming.get("host");
  const mode = modeForHost(host, publicHost());
  // Generated when Cloudflare did not send one, so a local run still joins its
  // two halves. `apps/cujo` trusts `cf-ray` from the edge and re-derives from
  // it, so forwarding the same value is what makes one query span both apps.
  const ray = incoming.get("cf-ray") ?? `cujo-${randomUUID()}`;

  // The SSE stream has its own route; a buffered passthrough here would break it.
  if (path[path.length - 1] === "events") {
    log.warn("proxy.rejected", { ...refusalFields(path, mode, "events_path"), ray });
    return Response.json({ ok: false, error: "use /api/runs/:id/events" }, { status: 404 });
  }
  if (mode === "public" && path[0] !== "public") {
    log.warn("proxy.rejected", { ...refusalFields(path, mode, "public_plane"), ray });
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const assertion = mode === "public" ? null : incoming.get("cf-access-jwt-assertion");
  const contentType = request.headers.get("content-type");

  const target = new URL(`${CUJO_API_URL()}/${path.map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}),
        ...(contentType ? { "content-type": contentType } : {}),
        // fetch always sends the target's own authority as Host, so the real
        // client host travels as a forwarded header instead.
        ...(host ? { "x-forwarded-host": host, "x-forwarded-proto": "https" } : {}),
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
      mode,
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
 * One export per method `apps/cujo` serves, because anything not exported here
 * is a 405 from Next and there is no other public route to reach it: the UI
 * host resolves to this app. Today that is GET and POST for the runs API and
 * PUT and DELETE for `/discord/channels/:owner/:name` (`apps/cujo/src/api.ts`).
 * A new verb on the Cujo API needs a matching export here.
 */
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}

export async function POST(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}

export async function PUT(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}

export async function DELETE(request: Request, context: Context) {
  return forward(request, (await context.params).path);
}
