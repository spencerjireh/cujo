import { CUJO_API_URL } from "@/lib/api/client";
import { sessionCookie } from "@/lib/api/owner";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";

/**
 * Where GitHub sends the browser back (decision 153). The code and state go
 * to `apps/cujo`, which trades the code for the verdict and a session; this
 * handler only turns that session into a cookie and sends the browser home.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return Response.json({ ok: false, error: "missing code or state" }, { status: 400 });
  let res: Response;
  try {
    res = await fetch(`${CUJO_API_URL()}/auth/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
      cache: "no-store",
    });
  } catch (error) {
    log.error("proxy.upstream.failed", { path: "/auth/callback", ...errorFields(error) });
    return Response.json({ ok: false, error: "cujo is unreachable" }, { status: 502 });
  }
  const body = (await res.json().catch(() => ({}))) as { session?: string; error?: string };
  if (!res.ok || !body.session) {
    return Response.json(
      { ok: false, error: body.error ?? "sign-in failed" },
      { status: res.ok ? 502 : res.status },
    );
  }
  const secure = url.protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": sessionCookie(body.session, secure),
      "cache-control": "no-store",
    },
  });
}
