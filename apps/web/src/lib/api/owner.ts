/**
 * The owner plane's half of the proxy, decided without touching a request
 * (decision 153). The handlers stay thin: what is allowed through, which
 * verbs, and how the browser's cookie becomes the bearer `apps/cujo` reads
 * are all answered here where a unit test can reach them.
 */

export const SESSION_COOKIE = "cujo_session";
/** A week, matching the session's own expiry in `apps/cujo`. */
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

/** What the proxy may forward: the anonymous read plane, or the owner plane with a session. */
export type Plane = "public" | "owner";

const OWNER_VERBS = new Set(["GET", "PATCH", "POST", "DELETE"]);

/** Which plane a proxied path belongs to, or null when it is neither. */
export function planeOf(path: readonly string[]): Plane | null {
  if (path[0] === "public") return "public";
  if (path[0] === "owner") return "owner";
  return null;
}

/** Whether the verb is allowed on the plane: the board reads; the owner also writes. */
export function verbAllowed(plane: Plane, method: string): boolean {
  if (plane === "public") return method === "GET" || method === "HEAD";
  return OWNER_VERBS.has(method);
}

/** The session id out of a Cookie header, or null. Only the exact shape the server issues. */
export function sessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=").trim();
      return /^[0-9a-f]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

/** The Set-Cookie value that stores a session, or clears one when `id` is null. */
export function sessionCookie(id: string | null, secure: boolean): string {
  const base = `${SESSION_COOKIE}=${id ?? ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return id ? `${base}; Max-Age=${SESSION_MAX_AGE_S}` : `${base}; Max-Age=0`;
}
