import { CUJO_API_URL } from "@/lib/api/client";
import { sessionCookie } from "@/lib/api/owner";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";

/**
 * Where GitHub sends the browser back (decision 153). The code and state go
 * to `apps/cujo`, which trades the code for the verdict and a session; this
 * handler only turns that session into a cookie and sends the browser home.
 *
 * A failure goes home too, with the reason in the query, because a person
 * left on this URL with a line of JSON has no way back. `expired` is cujo
 * refusing the state, which is what a sign-in that took over ten minutes
 * gets (`LOGIN_TTL_MS`); everything else is `failed`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Reason = "expired" | "failed";

function home(reason: Reason): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `/?signin=${reason}`, "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // GitHub sends `error=access_denied` and no code when the person cancels.
  if (!code || !state) {
    log.warn("auth.login.refused", { reason: url.searchParams.get("error") ?? "missing" });
    return home("failed");
  }
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
    return home("failed");
  }
  const body = (await res.json().catch(() => ({}))) as { session?: string; error?: string };
  if (!res.ok || !body.session) {
    log.warn("auth.login.refused", { http_status: res.status, reason: body.error ?? "no session" });
    return home(res.status === 400 ? "expired" : "failed");
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
