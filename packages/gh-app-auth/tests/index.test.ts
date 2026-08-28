import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type RequestFn,
  clearTokenCache,
  getInstallationIdForRepo,
  getInstallationToken,
  normalisePrivateKey,
} from "../src/index";

// A throwaway RSA key: the App JWT is signed locally, so the key must be real
// even though no request leaves the process.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

function fakeRequest(handler: (route: string, params: Record<string, unknown>) => unknown) {
  const fn = vi.fn(async (route: unknown, params?: unknown) => ({
    data: handler(String(route), (params ?? {}) as Record<string, unknown>),
    status: 200,
    headers: {},
    url: String(route),
  }));
  return fn as unknown as RequestFn & typeof fn;
}

describe("normalisePrivateKey", () => {
  it("turns literal backslash-n into newlines and ends with one newline", () => {
    const flat = "-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----";
    expect(normalisePrivateKey(flat)).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
    );
  });

  it("leaves a real PEM alone apart from trailing whitespace", () => {
    expect(normalisePrivateKey(`${privateKey}\n\n`)).toBe(privateKey.trimEnd().concat("\n"));
  });
});

describe("getInstallationToken", () => {
  beforeEach(() => clearTokenCache());

  it("exchanges the App JWT for an installation token and caches it", async () => {
    let calls = 0;
    const request = fakeRequest((route) => {
      expect(route).toBe("POST /app/installations/{installation_id}/access_tokens");
      calls += 1;
      return {
        token: `ghs_test_${calls}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        permissions: { pull_requests: "write" },
        repository_selection: "all",
      };
    });

    const first = await getInstallationToken({
      appId: "12345",
      privateKey,
      installationId: 42,
      request,
    });
    const second = await getInstallationToken({
      appId: "12345",
      privateKey,
      installationId: 42,
      request,
    });

    expect(first).toBe("ghs_test_1");
    expect(second).toBe("ghs_test_1");
    expect(calls).toBe(1);
  });

  it("mints again when the cached token is inside the expiry margin", async () => {
    let calls = 0;
    const request = fakeRequest(() => {
      calls += 1;
      return {
        token: `ghs_test_${calls}`,
        // Four minutes left: inside the five-minute margin, so treated as expired.
        expires_at: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
        permissions: {},
        repository_selection: "all",
      };
    });

    await getInstallationToken({ appId: "1", privateKey, installationId: 7, request });
    await getInstallationToken({ appId: "1", privateKey, installationId: 7, request });
    expect(calls).toBe(2);
  });
});

describe("getInstallationIdForRepo", () => {
  it("looks the installation up with the App JWT", async () => {
    const request = fakeRequest((route, params) => {
      expect(route).toBe("GET /repos/{owner}/{repo}/installation");
      expect(params.owner).toBe("spencerjireh");
      expect(params.repo).toBe("orders-api");
      const headers = params.headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^bearer ey/);
      return { id: 99 };
    });

    const id = await getInstallationIdForRepo({
      appId: "12345",
      privateKey,
      owner: "spencerjireh",
      repo: "orders-api",
      request,
    });
    expect(id).toBe(99);
  });

  it("rejects a response without an id", async () => {
    const request = fakeRequest(() => ({}));
    await expect(
      getInstallationIdForRepo({ appId: "1", privateKey, owner: "a", repo: "b", request }),
    ).rejects.toThrow("No installation id");
  });
});
