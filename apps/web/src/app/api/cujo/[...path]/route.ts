import { CUJO_API_URL } from "@/lib/api/client";
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
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(request: Request, path: string[]): Promise<Response> {
  // The SSE stream has its own route; a buffered passthrough here would break it.
  if (path[path.length - 1] === "events") {
    return Response.json({ ok: false, error: "use /api/runs/:id/events" }, { status: 404 });
  }

  const incoming = await headers();
  const assertion = incoming.get("cf-access-jwt-assertion");
  const host = incoming.get("host");
  const contentType = request.headers.get("content-type");

  const target = new URL(`${CUJO_API_URL()}/${path.map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      accept: "application/json",
      ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}),
      ...(contentType ? { "content-type": contentType } : {}),
      // fetch always sends the target's own authority as Host, so the real
      // client host travels as a forwarded header instead.
      ...(host ? { "x-forwarded-host": host, "x-forwarded-proto": "https" } : {}),
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    cache: "no-store",
    redirect: "manual",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}
