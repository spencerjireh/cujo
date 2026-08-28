import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";
import type { RequestEnv } from "../request-log";

/** Resolves the caller's email from a Cloudflare Access assertion, or null. */
export type AccessVerifier = (assertion: string | undefined) => Promise<string | null>;

/**
 * The verified email, set once by the gate in `index.ts` and read by any route
 * that records who acted. Declared here because this is what puts it there;
 * a route file that redeclared it would be describing someone else's promise.
 *
 * It extends `RequestEnv` for that same reason in reverse: `ray` and `log`
 * belong to every plane and are set above the host split, so this file states
 * only the variable it is responsible for and inherits the rest.
 */
export type Env = RequestEnv & { Variables: { email: string } };

/**
 * Cloudflare Access at the edge is the first gate; this is the second, so a
 * request that reaches the origin by another path is still refused
 * (docs/spec.md Contract 6).
 */
export function createAccessVerifier(options: {
  teamDomain: string;
  audience: string;
  jwks?: JWTVerifyGetKey;
}): AccessVerifier {
  const issuer = `https://${options.teamDomain}`;
  const jwks = options.jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (assertion) => {
    if (!assertion) return null;
    try {
      const { payload } = await jwtVerify(assertion, jwks, {
        issuer,
        audience: options.audience,
      });
      const email = payload.email;
      return typeof email === "string" && email ? email : null;
    } catch {
      return null;
    }
  };
}

/** Dev only: every request is an anonymous local operator. */
export const devVerifier: AccessVerifier = async () => "dev@localhost";
