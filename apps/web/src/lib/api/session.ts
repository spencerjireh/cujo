import { cookies } from "next/headers";
import { ApiError } from "./client";
import { sessionFromCookie } from "./owner";
import { fetchMe } from "./owner-client";

/**
 * The session id off the request's cookie, for a server component that reads
 * the owner plane on the reader's behalf. Server only by construction:
 * `next/headers` throws outside a request scope. This is the one place the
 * cookie is read outside the proxy, and it is read to be passed on as a
 * bearer, never to be printed.
 */
async function sessionFromRequest(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get("cujo_session")?.value;
  return value ? sessionFromCookie(`cujo_session=${value}`) : null;
}

export type Reader =
  | { me: { login: string; is_owner: boolean }; session: string }
  | { reason: "anonymous" | "not_owner" | "unconfigured" };

/**
 * Who the reader is, as an owner's page decides what to draw: the owner and
 * their session, or why not. A 404 from the plane is an instance with no
 * sign-in configured; a 403 is a signed-in non-owner; anything else reads as
 * signed out, which is the safe answer.
 */
export async function whoIsReading(): Promise<Reader> {
  const session = await sessionFromRequest();
  if (!session) return { reason: "anonymous" };
  try {
    const me = await fetchMe(session);
    return me.is_owner ? { me, session } : { reason: "not_owner" };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { reason: "unconfigured" };
    if (error instanceof ApiError && error.status === 403) return { reason: "not_owner" };
    return { reason: "anonymous" };
  }
}
