/**
 * Which plane this request is on (decision 34).
 *
 * One container answers both hostnames, so the mode cannot come from the
 * environment alone — it comes from the request's own `Host`, compared against
 * the single name configured as public.
 *
 * The polarity is the whole of this file. **Public only on an exact match;
 * everything else is operator.** An unknown host, a missing header, or an unset
 * `CUJO_PUBLIC_HOST` all resolve to `operator`, which calls the gated API,
 * gets 401 without an Access assertion, and renders "not signed in" — annoying,
 * and safe. The inverse default would serve the public view to anything it did
 * not recognise, which is how a config typo becomes a disclosure.
 *
 * There is deliberately no `CUJO_ADMIN_HOST`. Two names invite the rule
 * "not admin, therefore public", which is exactly the default this avoids.
 */

export type Mode = "public" | "operator";

/**
 * Strips the port and lowercases, the same way `apps/cujo`'s router does.
 * Without it `cujo.localhost:3000` never matches `cujo.localhost` and local
 * development silently only ever sees the operator view.
 */
export function normalizeHost(header: string | null | undefined): string {
  return (header ?? "").split(":")[0]?.toLowerCase() ?? "";
}

/** Pure, so the polarity above is testable without a request. */
export function modeForHost(host: string | null | undefined, configuredPublicHost: string): Mode {
  const publicHost = normalizeHost(configuredPublicHost);
  if (!publicHost) return "operator";
  return normalizeHost(host) === publicHost ? "public" : "operator";
}

/** `/public` on the public plane, and the gated routes' own root otherwise. */
export function apiPrefix(mode: Mode): string {
  return mode === "public" ? "/public" : "";
}

export const publicHost = () => process.env.CUJO_PUBLIC_HOST ?? "";

/**
 * Where a public visitor is sent to do something only an operator may do. Read
 * server-side and passed down, never a `NEXT_PUBLIC_` variable: those are baked
 * in at build time by the Dockerfile, which is the same reason `next.config.ts`
 * refuses to hold routing.
 */
export const adminBaseUrl = () => (process.env.CUJO_ADMIN_BASE_URL ?? "").replace(/\/+$/, "");

/** The mode of the request being rendered. Server components only. */
export async function serverMode(): Promise<Mode> {
  const { headers } = await import("next/headers");
  const incoming = await headers();
  return modeForHost(incoming.get("host"), publicHost());
}
