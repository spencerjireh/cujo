import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccessVerifier, devVerifier } from "../../../src/http/operator/access";

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

  it("returns the email of a valid assertion, and no reason to refuse it", async () => {
    expect(await verify(await sign({ email: "op@example.com" }))).toEqual({
      email: "op@example.com",
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
      expect((await verify(assertion)).email).toBeNull();
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
    expect(result).toEqual({ email: null, reason: "jwks_unavailable" });
  });
});

describe("devVerifier", () => {
  it("accepts everyone as the local operator", async () => {
    expect(await devVerifier(undefined)).toEqual({ email: "dev@localhost", reason: null });
  });
});
