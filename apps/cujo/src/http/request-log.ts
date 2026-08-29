/**
 * The correlation id, and the per-request logger that carries it (decision 37).
 *
 * No `.service.ts` suffix, deliberately: decision 32 reserves that for an
 * object holding state across requests, and this holds none. One logger is
 * bound per request and discarded with it.
 *
 * The middleware sits above the host split in `router.ts` rather than inside a
 * plane, so every request has a ray — including one for an unknown `Host`,
 * which is exactly the request somebody will be trying to explain.
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "@cujo/log";
import type { MiddlewareHandler } from "hono";

/**
 * Set by the middleware below and readable from any handler. `Env` in
 * `operator/access.ts` extends this rather than redeclaring it, for the reason
 * that file already gives about `email`: a route describing someone else's
 * promise is how two declarations drift apart.
 */
export type RequestEnv = { Variables: { ray: string; log: Logger } };

/**
 * Marks an id this process invented, so a query can tell it from one the edge
 * assigned. Locally there is no Cloudflare in front, and a generated id that
 * looked like a real ray would be worse than no id at all.
 */
export const GENERATED_RAY_PREFIX = "cujo-";

/**
 * How the ray reaches a delegated plane.
 *
 * `router.ts` answers most requests by calling `ui.fetch(c.req.raw)` or
 * `webhook.fetch(...)`, and a Hono instance builds a *fresh* context from that
 * raw request — nothing set with `c.set` on the outer context is visible
 * inside. So the value travels the only way it can: on the request itself.
 * Each plane then re-derives the same ray rather than inventing a second one.
 *
 * Set by this process and never trusted from outside: `router.ts` overwrites
 * it on every delegation, so a client sending its own is ignored.
 */
export const RAY_HEADER = "x-cujo-ray";

/**
 * Cloudflare's own request id. Decision 33 makes the origin Cloudflare-only, so
 * on the deployed path this is always present; absent means a local run or a
 * request that reached the container another way.
 */
export function rayFrom(header: string | undefined): string {
  const value = (header ?? "").trim();
  return value === "" ? `${GENERATED_RAY_PREFIX}${randomUUID()}` : value;
}

/**
 * The ray for a request.
 *
 * `trustForwarded` is the whole of this function. It is false at the edge, so
 * a client cannot choose what its own request is filed under by sending
 * `x-cujo-ray`; it is true only on the internal hop, where the header was put
 * there by `router.ts` one line earlier. Getting this backwards hands an
 * anonymous caller the ability to collide its requests with somebody else's
 * run in the log, which is why the parameter is required rather than defaulted
 * at the call sites that matter.
 */
export function rayOf(
  request: { header(name: string): string | undefined },
  trustForwarded: boolean,
): string {
  const forwarded = trustForwarded ? (request.header(RAY_HEADER) ?? "").trim() : "";
  return forwarded === "" ? rayFrom(request.header("cf-ray")) : forwarded;
}

/** Stamps the ray onto a request about to be handed to another Hono instance. */
export function withRay(request: Request, ray: string): Request {
  const headers = new Headers(request.headers);
  headers.set(RAY_HEADER, ray);
  return new Request(request, { headers });
}

/** Which plane answered, for a query that asks about a trust boundary. */
export type Plane = "public" | "ingress" | "unknown";

/**
 * `source: "edge"` for the outer router, which faces the internet and must
 * therefore ignore `x-cujo-ray`; `source: "delegated"` for an instance the
 * outer router hands a request to, where that header is how the ray survives
 * the hop. Spelled at every call site because the wrong one is a security
 * difference and not a style difference.
 */
export function requestLogger(
  root: Logger,
  source: "edge" | "delegated",
): MiddlewareHandler<RequestEnv> {
  return async (c, next) => {
    const ray = rayOf(c.req, source === "delegated");
    c.set("ray", ray);
    c.set("log", root.child({ ray }));
    await next();
  };
}
