/**
 * What a proxy failure says, decided without touching a request.
 *
 * The route handlers cannot be unit-tested here: they `await headers()` from
 * `next/headers`, which throws outside a request scope, and this app's vitest
 * config covers "data-layer units only" on purpose. So the part worth testing
 * — which failures are worth a line, and what that line carries — lives in
 * these pure functions, and the handlers stay thin enough to read.
 */

import type { Fields } from "@cujo/log";

/** Why the proxy refused a request before it reached `apps/cujo`. */
export type ProxyRefusal = "events_path" | "public_plane";

export function refusalFields(path: string[], reason: ProxyRefusal): Fields {
  return { path: `/${path.join("/")}`, reason };
}

/**
 * An upstream that answered, but not with a stream.
 *
 * The route deliberately passes a `503` through untouched so the client falls
 * back to polling (decision 34), so that one is `degraded` rather than
 * `failed`: it is `createStreamLimit`'s cap doing its job, not the service
 * breaking. Every other failure is an outage.
 *
 * This used to take the plane as well, because a `503` on the operator plane
 * was not the cap at all. There is one plane since decision 57, so the status
 * alone answers it.
 */
export function streamOutcome(
  status: number,
  ok: boolean,
): { event: "proxy.stream.degraded" | "proxy.stream.failed"; level: "warn" | "error" } {
  if (!ok && status === 503) return { event: "proxy.stream.degraded", level: "warn" };
  return { event: "proxy.stream.failed", level: "error" };
}

/**
 * The status to answer with when the upstream did not give a usable stream.
 *
 * A `200` with no body is the odd case: the upstream claimed success and sent
 * nothing, which the client cannot consume, so it becomes a `502` rather than
 * being forwarded as a success the caller would wait on forever.
 */
export function streamStatus(status: number): number {
  return status === 200 ? 502 : status;
}
