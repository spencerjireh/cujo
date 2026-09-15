import { CUJO_API_URL } from "@/lib/api/client";
import { sessionCookie, sessionFromCookie } from "@/lib/api/owner";
import { log } from "@/lib/log";
import { errorFields } from "@cujo/log";

/** Ends the session on both sides: the row in `apps/cujo` and the cookie. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = sessionFromCookie(request.headers.get("cookie"));
  if (id) {
    try {
      await fetch(`${CUJO_API_URL()}/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${id}` },
        cache: "no-store",
      });
    } catch (error) {
      log.error("proxy.upstream.failed", { path: "/auth/logout", ...errorFields(error) });
    }
  }
  const secure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": sessionCookie(null, secure),
      "cache-control": "no-store",
    },
  });
}
