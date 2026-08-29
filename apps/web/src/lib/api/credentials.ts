/**
 * What the operator plane is asked to believe about a request (decision 49).
 *
 * Two credentials for one release, and this is the one place that decides
 * which one to forward, so the proxy and the SSE route cannot drift apart.
 *
 * **The token never enters JavaScript.** An operator hands it over once at
 * `/login`, which sets an httpOnly cookie on this origin; a page cannot read
 * that cookie and neither can a script injected into one, so the only thing
 * that ever sees it again is the server-side handler here. That is the whole
 * reason the login exists rather than a field in local storage.
 *
 * The Cloudflare Access assertion is still forwarded when it is there, because
 * the deploy still has Access in front of it until it does not. `apps/cujo`
 * accepts either.
 */

/** The cookie `/login` sets, read by nothing in the browser. */
export const OPERATOR_COOKIE = "cujo_operator";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * The headers to send upstream, which may be none: an unauthenticated request
 * gets a 401 from `apps/cujo` and the page renders its "sign in" state. This
 * never fabricates a credential.
 */
export function operatorCredentials(incoming: Headers, request: Request): Record<string, string> {
  const token = cookieValue(request.headers.get("cookie"), OPERATOR_COOKIE);
  if (token) return { authorization: `Bearer ${token}` };
  const assertion = incoming.get("cf-access-jwt-assertion");
  return assertion ? { "cf-access-jwt-assertion": assertion } : {};
}
