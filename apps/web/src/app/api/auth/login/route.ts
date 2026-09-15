import { CUJO_API_URL } from "@/lib/api/client";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";

/**
 * Starts a sign-in (decision 153): asks `apps/cujo` for the GitHub authorize
 * URL, which carries a state only it knows, and sends the browser there.
 * Nothing here holds a secret; the client id and secret live in `apps/cujo`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${CUJO_API_URL()}/auth/login`, { method: "POST", cache: "no-store" });
    if (!res.ok) {
      log.warn("auth.unavailable", { http_status: res.status });
      return Response.json({ ok: false, error: "sign-in is not configured" }, { status: 404 });
    }
    const body = (await res.json()) as { url?: string };
    if (!body.url)
      return Response.json({ ok: false, error: "sign-in is not configured" }, { status: 404 });
    return Response.redirect(body.url, 302);
  } catch (error) {
    log.error("proxy.upstream.failed", { path: "/auth/login", ...errorFields(error) });
    return Response.json({ ok: false, error: "cujo is unreachable" }, { status: 502 });
  }
}
