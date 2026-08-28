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

  it("returns the email of a valid assertion", async () => {
    expect(await verify(await sign({ email: "op@example.com" }))).toBe("op@example.com");
  });

  it("refuses a missing, foreign-issuer, wrong-audience, wrong-key, or email-less assertion", async () => {
    expect(await verify(undefined)).toBeNull();
    expect(await verify("not.a.jwt")).toBeNull();
    expect(
      await verify(await sign({ email: "x@y" }, { issuer: "https://evil.cloudflareaccess.com" })),
    ).toBeNull();
    expect(await verify(await sign({ email: "x@y" }, { audience: "other" }))).toBeNull();
    expect(await verify(await otherKeySign({ email: "x@y" }))).toBeNull();
    expect(await verify(await sign({}))).toBeNull();
    expect(await verify(await sign({ email: "" }))).toBeNull();
  });
});

describe("devVerifier", () => {
  it("accepts everyone as the local operator", async () => {
    expect(await devVerifier(undefined)).toBe("dev@localhost");
  });
});
