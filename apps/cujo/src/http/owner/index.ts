/**
 * The owner plane (decision 153): the sign-in flow under `/auth` and the
 * routes a signed-in owner may call under `/owner`. Both live on the internal
 * host, reached only through `apps/web`'s proxy, which turns the browser's
 * cookie into the bearer this group reads.
 *
 * `/auth` is unauthenticated by nature and does three things: start a
 * sign-in, finish one, and end one. `/owner` refuses everything without an
 * unexpired owner session, with 401 — the first credentialed refusal in this
 * process since decision 57, and the decision says why that is right now.
 */

import type { Logger } from "@cujo/log";
import { errorFields } from "@cujo/log";
import { Hono } from "hono";
import { resolveOwner } from "../../auth/owner";
import type { GitHubOAuth } from "../../clients/github-oauth";
import { type ModelSettings, type SettingKey, type Settings, parseSetting } from "../../settings";
import type { RepositoryStore } from "../../store/repositories";
import type { WebSession, WebSessionStore } from "../../store/web-sessions";
import type { RequestEnv } from "../request-log";

export interface OwnerDeps {
  oauth: Pick<GitHubOAuth, "authorizeUrl" | "exchangeCode" | "user" | "installations" | "orgRole">;
  /** The App's numeric id, which is what an installation names. */
  appId: number;
  /** Where GitHub sends the browser back: the board's origin plus the web callback path. */
  redirectUri: string;
  sessions: WebSessionStore;
  settings: Pick<Settings, "current" | "sources" | "set">;
  repositories: Pick<RepositoryStore, "listAll" | "setEnabled" | "get">;
  log: Logger;
  now?: () => Date;
}

type OwnerEnv = RequestEnv & { Variables: RequestEnv["Variables"] & { session: WebSession } };

const SETTABLE: readonly SettingKey[] = [
  "model",
  "modelReasoningEffort",
  "modelTemperature",
  "modelMaxTokens",
  "diffModel",
  "diffBudgetTokens",
  "reviewMode",
  "modelProvider",
];

/** The provider with its key masked: the board shows that one exists, never what it is. */
function redacted(settings: ModelSettings) {
  const provider = settings.modelProvider;
  return {
    ...settings,
    modelProvider: provider ? { ...provider, apiKey: mask(provider.apiKey) } : null,
  };
}

const MASK_PREFIX = "****";
function mask(secret: string): string {
  return `${MASK_PREFIX}${secret.slice(-4)}`;
}

function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

export function ownerRoutes(deps: OwnerDeps): { auth: Hono<RequestEnv>; owner: Hono<RequestEnv> } {
  const now = deps.now ?? (() => new Date());

  const auth = new Hono<RequestEnv>();

  auth.post("/login", (c) => {
    const state = deps.sessions.startLogin(now());
    c.get("log").info("auth.login.started");
    return c.json({ ok: true, url: deps.oauth.authorizeUrl(state, deps.redirectUri) });
  });

  auth.post("/callback", async (c) => {
    const log = c.get("log");
    let body: { code?: unknown; state?: unknown };
    try {
      body = (await c.req.json()) as { code?: unknown; state?: unknown };
    } catch {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    if (typeof body.code !== "string" || typeof body.state !== "string") {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    if (!deps.sessions.finishLogin(body.state, now())) {
      log.warn("auth.login.refused", { reason: "state" });
      return c.json({ ok: false, error: "sign-in expired or was not started here" }, 400);
    }
    try {
      const token = await deps.oauth.exchangeCode(body.code, deps.redirectUri);
      const user = await deps.oauth.user(token);
      const installations = await deps.oauth.installations(token);
      const verdict = await resolveOwner(deps.appId, user, installations, deps.oauth, token);
      const id = deps.sessions.create(
        { login: user.login, userId: user.id, isOwner: verdict.isOwner },
        now(),
      );
      log.info("auth.login.completed", {
        actor: user.login,
        is_owner: verdict.isOwner,
        count: verdict.through.length,
      });
      return c.json({ ok: true, session: id, login: user.login, is_owner: verdict.isOwner });
    } catch (error) {
      log.warn("auth.login.refused", { reason: "github", ...errorFields(error) });
      return c.json({ ok: false, error: "GitHub did not complete the sign-in" }, 502);
    }
  });

  auth.post("/logout", (c) => {
    const id = bearer(c.req.header("authorization"));
    const ended = id ? deps.sessions.delete(id) : false;
    if (ended) c.get("log").info("auth.logout");
    return c.json({ ok: true, ended });
  });

  const owner = new Hono<OwnerEnv>();

  owner.use("*", async (c, next) => {
    const id = bearer(c.req.header("authorization"));
    const session = id ? deps.sessions.get(id, now()) : null;
    if (!session) return c.json({ ok: false, error: "sign in" }, 401);
    if (!session.isOwner) return c.json({ ok: false, error: "not an owner of this App" }, 403);
    c.set("session", session);
    c.set("log", c.get("log").child({ actor: session.login }));
    await next();
  });

  owner.get("/me", (c) => {
    const session = c.get("session");
    return c.json({
      ok: true,
      login: session.login,
      is_owner: session.isOwner,
      expires_at: session.expiresAt,
    });
  });

  owner.get("/settings", (c) => {
    return c.json({
      ok: true,
      settings: redacted(deps.settings.current()),
      sources: deps.settings.sources(),
    });
  });

  owner.patch("/settings", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    const keys = Object.keys(body);
    const unknown = keys.filter((k) => !SETTABLE.includes(k as SettingKey));
    if (unknown.length) return c.json({ ok: false, error: `unknown setting: ${unknown[0]}` }, 400);
    // The mask the board was shown, sent back unchanged, means "keep the one
    // you have". Compared to the exact mask this process issued, not to a
    // prefix: a real key that happened to begin with the mask's characters
    // would otherwise be silently replaced by the stored one.
    const provider = body.modelProvider as Record<string, unknown> | null | undefined;
    if (provider && typeof provider === "object" && typeof provider.apiKey === "string") {
      const current = deps.settings.current().modelProvider;
      if (current && provider.apiKey === mask(current.apiKey)) {
        body.modelProvider = { ...provider, apiKey: current.apiKey };
      }
    }
    // Validate everything before writing anything, so a bad second key does not
    // leave a good first one applied.
    const staged: Array<[SettingKey, unknown]> = [];
    try {
      for (const key of keys as SettingKey[]) {
        parseSetting(key, body[key]);
        staged.push([key, body[key]]);
      }
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : "invalid" }, 400);
    }
    for (const [key, value] of staged) deps.settings.set(key, value);
    c.get("log").info("owner.settings.changed", { count: staged.length });
    return c.json({
      ok: true,
      settings: redacted(deps.settings.current()),
      sources: deps.settings.sources(),
    });
  });

  owner.get("/repositories", (c) => {
    return c.json({ ok: true, repositories: deps.repositories.listAll() });
  });

  owner.patch("/repositories/:owner/:name", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    let body: { enabled?: unknown };
    try {
      body = (await c.req.json()) as { enabled?: unknown };
    } catch {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    if (typeof body.enabled !== "boolean")
      return c.json({ ok: false, error: "enabled must be a boolean" }, 400);
    if (!deps.repositories.setEnabled(repo, body.enabled, now().toISOString())) {
      return c.json({ ok: false, error: "not found" }, 404);
    }
    c.get("log").info("owner.repository.changed", { repo, enabled: body.enabled });
    return c.json({ ok: true, repository: deps.repositories.get(repo) });
  });

  owner.all("*", (c) => c.json({ ok: false, error: "not found" }, 404));

  // `owner` carries one more request variable, the session, than the router's
  // `RequestEnv` declares. Hono's `route()` wants the parent's environment;
  // the variable is set by this group's own middleware before any handler
  // reads it, so widening the type at the boundary loses nothing a caller
  // could reach.
  return { auth, owner: owner as unknown as Hono<RequestEnv> };
}
