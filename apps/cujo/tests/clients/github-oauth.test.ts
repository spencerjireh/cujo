import { describe, expect, it, vi } from "vitest";
import { GitHubOAuth } from "../../src/clients/github-oauth";

function fakeFetch(route: (url: URL, init?: RequestInit) => Response) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return route(url, init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("GitHubOAuth (decision 153)", () => {
  it("builds the authorize url with the client id, the callback and the state, and no scopes", () => {
    const oauth = new GitHubOAuth("cid", "secret");
    const url = new URL(oauth.authorizeUrl("st4te", "https://board.example/api/auth/callback"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://board.example/api/auth/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("trades the code for a token with the secret, and refuses a body without one", async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ access_token: "ghu_x" })));
    const oauth = new GitHubOAuth("cid", "secret", f.impl);
    expect(await oauth.exchangeCode("c0de", "https://board.example/cb")).toBe("ghu_x");
    const sent = JSON.parse(String(f.calls[0]?.init?.body));
    expect(sent).toEqual({
      client_id: "cid",
      client_secret: "secret",
      code: "c0de",
      redirect_uri: "https://board.example/cb",
    });
    const bad = new GitHubOAuth(
      "cid",
      "secret",
      fakeFetch(() => new Response(JSON.stringify({ error: "bad_verification_code" }))).impl,
    );
    await expect(bad.exchangeCode("x", "y")).rejects.toThrow(/bad_verification_code/);
  });

  it("reads the user and the installations with the token, dropping malformed entries", async () => {
    const f = fakeFetch((url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghu_x");
      if (url.pathname === "/user")
        return new Response(JSON.stringify({ login: "octocat", id: 1 }));
      return new Response(
        JSON.stringify({
          installations: [
            { id: 10, app_id: 7, account: { login: "octocat", id: 1, type: "User" } },
            { id: 11, app_id: 7, account: { login: "acme", id: 2, type: "Organization" } },
            { id: 12, app_id: 7, account: { login: "odd", id: 3, type: "Bot" } },
            { id: "nope" },
          ],
        }),
      );
    });
    const oauth = new GitHubOAuth("cid", "secret", f.impl);
    expect(await oauth.user("ghu_x")).toEqual({ login: "octocat", id: 1 });
    expect(await oauth.installations("ghu_x")).toEqual([
      { id: 10, appId: 7, account: { login: "octocat", id: 1, type: "User" } },
      { id: 11, appId: 7, account: { login: "acme", id: 2, type: "Organization" } },
    ]);
  });

  it("answers the organisation role, or null for a non-member", async () => {
    const f = fakeFetch((url) => {
      if (url.pathname.endsWith("/acme"))
        return new Response(JSON.stringify({ state: "active", role: "admin" }));
      if (url.pathname.endsWith("/pending"))
        return new Response(JSON.stringify({ state: "pending", role: "admin" }));
      return new Response("{}", { status: 404 });
    });
    const oauth = new GitHubOAuth("cid", "secret", f.impl);
    expect(await oauth.orgRole("t", "acme")).toBe("admin");
    expect(await oauth.orgRole("t", "pending")).toBeNull();
    expect(await oauth.orgRole("t", "stranger")).toBeNull();
  });
});
