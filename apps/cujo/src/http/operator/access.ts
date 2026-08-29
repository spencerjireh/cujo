import { timingSafeEqual } from "node:crypto";
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
  | "no_email"
  | "no_token"
  | "bad_token";

export interface AccessResult {
  operator: string | null;
  reason: DenialReason | null;
}

/** Resolves the caller from a Cloudflare Access assertion, or null. */
export type AccessVerifier = (assertion: string | undefined) => Promise<AccessResult>;

/**
 * Who a decision made on this plane is recorded against.
 *
 * A fixed string rather than a person, because a shared token names nobody —
 * and saying `operator` is honest where an email would have been a claim the
 * gate can no longer support. It is a downward swap of principal, which
 * decision 28 refused and decision 49 accepts only because the action that
 * justified the email — publishing an accusation — moved to the pull request,
 * where the principal is repo write and the trail is a GitHub login.
 */
export const OPERATOR_IDENTITY = "operator";

/**
 * The verified operator, set once by the gate in `index.ts` and read by any
 * route that records who acted. Declared here because this is what puts it
 * there; a route file that redeclared it would be describing someone else's
 * promise.
 *
 * It extends `RequestEnv` for that same reason in reverse: `ray` and `log`
 * belong to every plane and are set above the host split, so this file states
 * only the variable it is responsible for and inherits the rest.
 */
export type Env = RequestEnv & { Variables: { operator: string } };

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
      break;
  }
  // Every other JWKS code, by prefix rather than by name: jose has several
  // (timeout, invalid, unreachable) and adds more, and an operator reading
  // "malformed" would go looking at the client's token when the key service
  // is the thing that is down.
  if (typeof code === "string" && code.startsWith("ERR_JWKS")) return "jwks_unavailable";
  // A failed fetch of the key set reaches here as undici's TypeError with the
  // real reason on `cause`, carrying no jose code at all.
  if (error instanceof TypeError && error.cause !== undefined) return "jwks_unavailable";
  return "malformed";
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
    if (!assertion) return { operator: null, reason: "no_assertion" };
    try {
      const { payload } = await jwtVerify(assertion, jwks, {
        issuer,
        audience: options.audience,
      });
      const email = payload.email;
      // A token that verifies but names nobody is its own case: the signature
      // was good, so this is a configuration problem rather than an attack.
      // Still checked, because its absence says the assertion is not the shape
      // Access issues — but the email is not what gets recorded.
      if (typeof email !== "string" || !email) return { operator: null, reason: "no_email" };
      // The fixed identity, not the email, even though one is right here.
      // `authorized_by` must not depend on which transitional credential a
      // request happened to carry: a reader would have to know which gate was
      // configured on the day to know what a row means. The plane records
      // `operator` because that is what it can prove about anyone who reaches
      // it — an accusation is decided on the pull request now (decision 49).
      return { operator: OPERATOR_IDENTITY, reason: null };
    } catch (error) {
      return { operator: null, reason: reasonFor(error) };
    }
  };
}

/**
 * The bearer token, checked in constant time.
 *
 * A shared secret compared with `===` leaks its prefix to anyone who can time
 * the answer, and this one gates every write on the plane. Lengths are
 * compared first because `timingSafeEqual` throws on a mismatch, which is the
 * one thing about the token this does reveal — and a length is not a secret.
 */
export function verifyOperatorToken(expected: string, presented: string | undefined): AccessResult {
  if (!presented) return { operator: null, reason: "no_token" };
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { operator: null, reason: "bad_token" };
  }
  return { operator: OPERATOR_IDENTITY, reason: null };
}

/** Dev only: every request is an anonymous local operator. */
export const devVerifier: AccessVerifier = async () => ({
  operator: OPERATOR_IDENTITY,
  reason: null,
});
