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
 * Cloudflare's own request id. Decision 33 makes the origin Cloudflare-only, so
 * on the deployed path this is always present; absent means a local run or a
 * request that reached the container another way.
 */
export function rayFrom(header: string | undefined): string {
  const value = (header ?? "").trim();
  return value === "" ? `${GENERATED_RAY_PREFIX}${randomUUID()}` : value;
}

/** Which plane answered, for a query that asks about a trust boundary. */
export type Plane = "operator" | "public" | "ingress" | "unknown";

export function requestLogger(root: Logger): MiddlewareHandler<RequestEnv> {
  return async (c, next) => {
    const ray = rayFrom(c.req.header("cf-ray"));
    c.set("ray", ray);
    c.set("log", root.child({ ray }));
    await next();
  };
}
