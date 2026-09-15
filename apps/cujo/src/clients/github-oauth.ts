/**
 * GitHub's OAuth web flow, on the GitHub App's own client id and secret
 * (decision 153). Three calls after the redirect: trade the code for a user
 * token, ask who the token is, and ask which installations of the App that
 * person can see. The token lives for the sign-in and is then forgotten.
 *
 * `fetchImpl` is injected the way `GitHubReader` takes it, so the flow is
 * testable with no GitHub.
 */

export interface OAuthUser {
  login: string;
  id: number;
}

export interface OAuthInstallation {
  id: number;
  appId: number;
  account: { login: string; id: number; type: "User" | "Organization" };
}

const API = "https://api.github.com";
const WEB = "https://github.com";

class GitHubOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`github ${path} returned ${status}`);
    this.name = "GitHubOAuthError";
  }
}

export class GitHubOAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Where the browser goes to sign in. No scopes: a GitHub App's OAuth grants what the App holds. */
  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(`${WEB}/login/oauth/authorize`);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** The code from the callback, traded for a user token. */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const res = await this.fetchImpl(`${WEB}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new GitHubOAuthError(res.status, "/login/oauth/access_token");
    const body = (await res.json()) as { access_token?: unknown; error?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new GitHubOAuthError(
        400,
        `/login/oauth/access_token (${String(body.error ?? "no token")})`,
      );
    }
    return body.access_token;
  }

  async user(token: string): Promise<OAuthUser> {
    const body = await this.get<{ login: unknown; id: unknown }>(token, "/user");
    if (typeof body.login !== "string" || typeof body.id !== "number") {
      throw new GitHubOAuthError(502, "/user");
    }
    return { login: body.login, id: body.id };
  }

  /** Every installation the person can see, of any App. */
  async installations(token: string): Promise<OAuthInstallation[]> {
    const body = await this.get<{ installations?: unknown }>(
      token,
      "/user/installations?per_page=100",
    );
    if (!Array.isArray(body.installations)) return [];
    const out: OAuthInstallation[] = [];
    for (const item of body.installations as Record<string, unknown>[]) {
      const account = item.account as Record<string, unknown> | undefined;
      if (
        typeof item.id !== "number" ||
        typeof item.app_id !== "number" ||
        !account ||
        typeof account.login !== "string" ||
        typeof account.id !== "number" ||
        (account.type !== "User" && account.type !== "Organization")
      ) {
        continue;
      }
      out.push({
        id: item.id,
        appId: item.app_id,
        account: { login: account.login, id: account.id, type: account.type },
      });
    }
    return out;
  }

  /** The person's role in an organisation, or null when they are not a member. */
  async orgRole(token: string, org: string): Promise<"admin" | "member" | null> {
    const res = await this.fetchImpl(`${API}/user/memberships/orgs/${encodeURIComponent(org)}`, {
      headers: this.headers(token),
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new GitHubOAuthError(res.status, "/user/memberships/orgs");
    const body = (await res.json()) as { role?: unknown; state?: unknown };
    if (body.state !== "active") return null;
    return body.role === "admin" ? "admin" : "member";
  }

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "cujo",
    };
  }

  private async get<T>(token: string, path: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, { headers: this.headers(token) });
    if (!res.ok) throw new GitHubOAuthError(res.status, path);
    return (await res.json()) as T;
  }
}
