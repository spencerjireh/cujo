import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  OPERATOR_IDENTITY,
  createAccessVerifier,
  devVerifier,
  verifyOperatorToken,
} from "../../../src/http/operator/access";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag";

describe("createAccessVerifier", () => {
  let sign: (
    claims: Record<string, unknown>,
    opts?: { issuer?: string; audience?: string },
  ) => Promise<string>;
  let verify: ReturnType<typeof createAccessVerifier>;
  let otherKeySign: typeof sign;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    verify = createAccessVerifier({
      teamDomain: TEAM,
      audience: AUD,
      jwks: createLocalJWKSet({ keys: [jwk] }),
    });
    const signer =
      (key: Parameters<SignJWT["sign"]>[0]) =>
      async (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string } = {}) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(opts.issuer ?? `https://${TEAM}`)
          .setAudience(opts.audience ?? AUD)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(key);
    sign = signer(privateKey);
    otherKeySign = signer(other.privateKey);
  });

  it("accepts a valid assertion as the fixed identity, not as its email", async () => {
    // The email is still required — its absence says the assertion is not the
    // shape Access issues — but it is not what gets recorded. `authorized_by`
    // must not depend on which transitional credential a request carried, or a
    // reader would need to know which gate was configured that day to know
    // what a row means (decision 48).
    expect(await verify(await sign({ email: "op@example.com" }))).toEqual({
      operator: OPERATOR_IDENTITY,
      reason: null,
    });
  });

  it("refuses a missing, foreign-issuer, wrong-audience, wrong-key, or email-less assertion", async () => {
    for (const assertion of [
      undefined,
      "not.a.jwt",
      await sign({ email: "x@y" }, { issuer: "https://evil.cloudflareaccess.com" }),
      await sign({ email: "x@y" }, { audience: "other" }),
      await otherKeySign({ email: "x@y" }),
      await sign({}),
      await sign({ email: "" }),
    ]) {
      expect((await verify(assertion)).operator).toBeNull();
    }
  });

  /**
   * The caller still gets a bare 401 either way — naming the failing check
   * tells a stranger how to pass it. These reasons exist for the operator
   * debugging their own login, and they are only useful if they are distinct:
   * an expired token, an app id that has gone stale, and an unreachable JWKS
   * are three different jobs.
   */
  it("says which check failed, distinctly", async () => {
    const reasonFor = async (assertion: string | undefined) => (await verify(assertion)).reason;
    expect(await reasonFor(undefined)).toBe("no_assertion");
    expect(await reasonFor("not.a.jwt")).toBe("malformed");
    expect(
      await reasonFor(
        await sign({ email: "x@y" }, { issuer: "https://evil.cloudflareaccess.com" }),
      ),
    ).toBe("wrong_issuer");
    expect(await reasonFor(await sign({ email: "x@y" }, { audience: "other" }))).toBe(
      "wrong_audience",
    );
    expect(await reasonFor(await otherKeySign({ email: "x@y" }))).toBe("bad_signature");
    // Verified, but names nobody: a configuration problem, not an attack.
    expect(await reasonFor(await sign({}))).toBe("no_email");
  });

  it("blames the key service when the key service is what failed", async () => {
    // An operator reading "malformed" would go looking at the client's token
    // while Access's own key endpoint is the thing that is down. Every JWKS
    // code is matched by prefix, and a failed fetch arrives as undici's
    // TypeError with no jose code at all.
    const unreachable = createAccessVerifier({
      teamDomain: TEAM,
      audience: AUD,
      jwks: () => {
        const failure = new TypeError("fetch failed");
        failure.cause = new Error("ENOTFOUND");
        throw failure;
      },
    });
    const result = await unreachable(await sign({ email: "op@example.com" }));
    expect(result).toEqual({ operator: null, reason: "jwks_unavailable" });
  });
});

describe("devVerifier", () => {
  it("accepts everyone as the local operator", async () => {
    expect(await devVerifier(undefined)).toEqual({ operator: "operator", reason: null });
  });
});

describe("verifyOperatorToken", () => {
  it("accepts the token and records the fixed identity", () => {
    // A shared token names nobody, and `operator` says so. An email here
    // would be a claim the gate can no longer support (decision 48).
    expect(verifyOperatorToken("s3cret", "s3cret")).toEqual({
      operator: OPERATOR_IDENTITY,
      reason: null,
    });
    expect(OPERATOR_IDENTITY).toBe("operator");
  });

  it("tells a missing token apart from a wrong one, for the log", () => {
    expect(verifyOperatorToken("s3cret", undefined)).toEqual({
      operator: null,
      reason: "no_token",
    });
    expect(verifyOperatorToken("s3cret", "")).toEqual({ operator: null, reason: "no_token" });
    expect(verifyOperatorToken("s3cret", "wrong!")).toEqual({
      operator: null,
      reason: "bad_token",
    });
  });

  it("refuses a token of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, which would turn a bad
    // credential into a 500 and take the reason out of the log.
    expect(verifyOperatorToken("s3cret", "s3")).toEqual({ operator: null, reason: "bad_token" });
    expect(verifyOperatorToken("s3cret", "s3cret-and-more")).toEqual({
      operator: null,
      reason: "bad_token",
    });
  });

  it("refuses a prefix of the real token", () => {
    // The property constant-time comparison exists for: an attacker must not
    // learn that they have the first four characters right.
    expect(verifyOperatorToken("s3cretvalue", "s3cr").operator).toBeNull();
  });
});
