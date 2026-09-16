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
import type { GitHubReader } from "../../clients/github";
import type { GitHubOAuth } from "../../clients/github-oauth";
import { INSTRUCTIONS_BYTES, INSTRUCTIONS_PATH } from "../../review/instructions";
import { cut } from "../../review/prepare";
import type { Runner } from "../../review/runner.service";
import { REVIEW_MODES, type ReviewMode } from "../../review/types";
import { type ModelSettings, type SettingKey, type Settings, parseSetting } from "../../settings";
import type { RunStore } from "../../store";
import type { RepositoryStore } from "../../store/repositories";
import type { RepositorySettingsStore } from "../../store/repository-settings";
import type { WebSession, WebSessionStore } from "../../store/web-sessions";
import { serializePublicRun, serializePublicSummary } from "../public/serialize";
import { createStreamLimit } from "../public/stream-limit";
import type { RequestEnv } from "../request-log";
import { streamRun } from "../run-stream";

export interface OwnerDeps {
  oauth: Pick<GitHubOAuth, "authorizeUrl" | "exchangeCode" | "user" | "installations" | "orgRole">;
  /** The App's numeric id, which is what an installation names. */
  appId: number;
  /** Where GitHub sends the browser back: the board's origin plus the web callback path. */
  redirectUri: string;
  sessions: WebSessionStore;
  settings: Pick<Settings, "current" | "sources" | "set">;
  repositories: Pick<RepositoryStore, "listAll" | "setEnabled" | "get">;
  /** The board's per-repository layer (decision 155). */
  repositorySettings: Pick<RepositorySettingsStore, "get" | "set">;
  /** For what the repository's own file says, and what GitHub says about the App. */
  github: Pick<GitHubReader, "declaredMode" | "readFile" | "appState">;
  /** Whether the process can take a run right now: the same answer `/readyz` gives. */
  health: () => { harness: "ready" | "bootstrapping"; store: "ok" | "error"; uptimeMs: number };
  /** Every run, private ones included (decision 159). */
  runs: Pick<RunStore, "listRunsWithDigests">;
  runner: Pick<Runner, "view" | "changes">;
  /** Concurrent owner streams held at once; an owner is one person with a few tabs. */
  streamLimit?: number;
  log: Logger;
  now?: () => Date;
}

/** Streams one owner may hold at once: a few tabs, not the internet's 200. */
const OWNER_STREAM_LIMIT = 20;

type OwnerEnv = RequestEnv & { Variables: RequestEnv["Variables"] & { session: WebSession } };

/**
 * Where the board reads a repository's own file: GitHub's contents API
 * resolves `HEAD` to the default branch, and the registry does not hold the
 * branch's name. The review reads the same file at the pull request's base.
 */
const DEFAULT_BRANCH_REF = "HEAD";

/** What the reviews need from the App, by GitHub's permission names (README). */
const NEEDED_PERMISSIONS: readonly [string, "read" | "write"][] = [
  ["contents", "read"],
  ["metadata", "read"],
  ["pull_requests", "write"],
  ["checks", "write"],
  ["issues", "read"],
];
const LEVEL: Record<string, number> = { read: 1, write: 2, admin: 3 };

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

  /**
   * The App as GitHub sees it, beside what this instance needs from it
   * (decision 157). The permissions it should hold are the README's list;
   * a level below the needed one is what a missing review looks like before
   * it is a missing review. The registry's counts ride along so the page can
   * say how many repositories each installation covers.
   */
  owner.get("/bot", async (c) => {
    try {
      const state = await deps.github.appState();
      const held = state.app.permissions;
      const permissions = NEEDED_PERMISSIONS.map(([name, needed]) => {
        const level = held[name] ?? null;
        return {
          name,
          needed,
          held: level,
          ok: level !== null && (LEVEL[level] ?? 0) >= (LEVEL[needed] ?? 0),
        };
      });
      const active = deps.repositories.listAll().filter((row) => row.removedAt === null);
      const installations = state.installations.map((installation) => ({
        ...installation,
        repositories: active.filter((row) => row.installationId === installation.id).length,
      }));
      return c.json({
        ok: true,
        app: state.app,
        permissions,
        installations,
        deliveries: state.deliveries,
      });
    } catch (error) {
      c.get("log").warn("owner.bot.read.failed", errorFields(error));
      return c.json({ ok: false, error: "GitHub did not answer for the App" }, 502);
    }
  });

  owner.get("/health", (c) => {
    const health = deps.health();
    return c.json({
      ok: true,
      ...health,
      ready: health.harness === "ready" && health.store === "ok",
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

  /**
   * The three layers for one repository, and what wins (decision 155):
   * the file at the default branch where it sets a key, else the board,
   * else the instance. The board mirrors the file's value and says so, so
   * an owner sees what the next run will do and where that came from.
   */
  owner.get("/repositories/:owner/:name/settings", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!deps.repositories.get(repo)) return c.json({ ok: false, error: "not found" }, 404);
    const board = deps.repositorySettings.get(repo);
    let fileMode: ReviewMode | null = null;
    let fileInstructions: string | null = null;
    try {
      fileMode = await deps.github.declaredMode(repo, DEFAULT_BRANCH_REF);
      fileInstructions = await deps.github.readFile(repo, INSTRUCTIONS_PATH, DEFAULT_BRANCH_REF);
    } catch (error) {
      c.get("log").warn("owner.repository.file.failed", { repo, ...errorFields(error) });
      return c.json({ ok: false, error: "GitHub did not answer for the repository's file" }, 502);
    }
    const instanceMode = deps.settings.current().reviewMode;
    const effective = {
      mode: fileMode
        ? { value: fileMode, source: "file" as const }
        : board.mode
          ? { value: board.mode, source: "board" as const }
          : { value: instanceMode, source: "instance" as const },
      // Cut the way the brief cuts it, so the board shows what a run reads.
      instructions: fileInstructions?.trim()
        ? { ...cut(fileInstructions, INSTRUCTIONS_BYTES), source: "file" as const }
        : board.instructions?.trim()
          ? { ...cut(board.instructions, INSTRUCTIONS_BYTES), source: "board" as const }
          : null,
    };
    return c.json({
      ok: true,
      board: { mode: board.mode, instructions: board.instructions, updated_at: board.updatedAt },
      file: { mode: fileMode, instructions: fileInstructions, path: INSTRUCTIONS_PATH },
      instance: { mode: instanceMode },
      effective,
    });
  });

  owner.patch("/repositories/:owner/:name/settings", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!deps.repositories.get(repo)) return c.json({ ok: false, error: "not found" }, 404);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "invalid" }, 400);
    }
    const patch: { mode?: ReviewMode | null; instructions?: string | null } = {};
    if ("mode" in body) {
      const mode = body.mode;
      if (mode !== null && !REVIEW_MODES.includes(mode as ReviewMode)) {
        return c.json(
          { ok: false, error: `mode must be one of ${REVIEW_MODES.join(", ")} or null` },
          400,
        );
      }
      patch.mode = mode as ReviewMode | null;
    }
    if ("instructions" in body) {
      const text = body.instructions;
      if (text !== null && typeof text !== "string") {
        return c.json({ ok: false, error: "instructions must be text or null" }, 400);
      }
      if (typeof text === "string" && Buffer.byteLength(text, "utf8") > INSTRUCTIONS_BYTES) {
        return c.json(
          { ok: false, error: `instructions must be at most ${INSTRUCTIONS_BYTES} bytes` },
          400,
        );
      }
      patch.instructions =
        typeof text === "string" && text.trim() === "" ? null : (text as string | null);
    }
    if (!("mode" in patch) && !("instructions" in patch)) {
      return c.json({ ok: false, error: "nothing to change" }, 400);
    }
    const saved = deps.repositorySettings.set(repo, patch, now().toISOString());
    c.get("log").info("owner.repository.settings.changed", {
      repo,
      count: Object.keys(patch).length,
    });
    return c.json({
      ok: true,
      board: { mode: saved.mode, instructions: saved.instructions, updated_at: saved.updatedAt },
    });
  });

  // The runs, private ones included (decision 159): the public plane's own
  // shapes and serializers with the visibility filter left out, since who
  // is asking has already been settled above. The same stream code, with a
  // limit sized for one person's tabs and not the internet.
  const streams = createStreamLimit(deps.streamLimit ?? OWNER_STREAM_LIMIT);
  owner.get("/runs", (c) => {
    return c.json({ runs: deps.runs.listRunsWithDigests().map(serializePublicSummary) });
  });

  owner.get("/runs/:id", (c) => {
    const view = deps.runner.view(c.req.param("id"));
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return c.json(serializePublicRun(view));
  });

  owner.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const view = deps.runner.view(id);
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return streamRun(c, id, view, {
      runner: deps.runner,
      visible: (runId) => deps.runner.view(runId),
      admits: () => true,
      limit: streams,
      limitSize: deps.streamLimit ?? OWNER_STREAM_LIMIT,
      plane: "owner",
    });
  });

  owner.all("*", (c) => c.json({ ok: false, error: "not found" }, 404));

  // `owner` carries one more request variable, the session, than the router's
  // `RequestEnv` declares. Hono's `route()` wants the parent's environment;
  // the variable is set by this group's own middleware before any handler
  // reads it, so widening the type at the boundary loses nothing a caller
  // could reach.
  return { auth, owner: owner as unknown as Hono<RequestEnv> };
}
