import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";
import type { RequestEnv } from "../request-log";

/**
 * Why an assertion was refused (decision 37).
 *
 * A closed set, because the answer to the caller stays a bare 401 — telling a
 * stranger *which* check failed is telling them how to pass it — while the
 * operator debugging their own login needs to know whether the token expired,
 * whether it was minted for a different application, or whether the origin
 * simply could not reach Cloudflare's keys. The distinction lives in the log
 * and not in the response.
 */
export type DenialReason =
  | "no_assertion"
  | "expired"
  | "wrong_audience"
  | "wrong_issuer"
  | "bad_signature"
  | "malformed"
  | "jwks_unavailable"
  | "no_email";

export interface AccessResult {
  email: string | null;
  reason: DenialReason | null;
}

/** Resolves the caller's email from a Cloudflare Access assertion, or null. */
export type AccessVerifier = (assertion: string | undefined) => Promise<AccessResult>;

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
 * jose's own error codes, mapped to the closed set.
 *
 * `error.code` rather than `instanceof`: the codes are jose's documented
 * surface and survive a minor upgrade that reshuffles the classes. Anything
 * unrecognised falls to `malformed`, which is the safe reading — an assertion
 * this code cannot explain is one it should not accept.
 */
function reasonFor(error: unknown): DenialReason {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return "expired";
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return "bad_signature";
    case "ERR_JWKS_TIMEOUT":
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
      return "jwks_unavailable";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      // The claim that failed says which of the two mismatches it was, and
      // they mean very different things: a wrong audience is usually the app
      // id being stale, a wrong issuer is the wrong team domain entirely.
      const claim =
        typeof error === "object" && error !== null ? Reflect.get(error, "claim") : null;
      if (claim === "aud") return "wrong_audience";
      if (claim === "iss") return "wrong_issuer";
      return "malformed";
    }
    default:
      return "malformed";
  }
}

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
    if (!assertion) return { email: null, reason: "no_assertion" };
    try {
      const { payload } = await jwtVerify(assertion, jwks, {
        issuer,
        audience: options.audience,
      });
      const email = payload.email;
      // A token that verifies but names nobody is its own case: the signature
      // was good, so this is a configuration problem rather than an attack.
      if (typeof email !== "string" || !email) return { email: null, reason: "no_email" };
      return { email, reason: null };
    } catch (error) {
      return { email: null, reason: reasonFor(error) };
    }
  };
}

/** Dev only: every request is an anonymous local operator. */
export const devVerifier: AccessVerifier = async () => ({
  email: "dev@localhost",
  reason: null,
});
