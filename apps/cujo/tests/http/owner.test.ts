/**
 * The owner plane (decision 153): sign-in through `/auth`, the session as a
 * bearer, and what `/owner` allows a signed-in owner and refuses everyone else.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader } from "../../src/clients/github";
import type { OAuthInstallation } from "../../src/clients/github-oauth";
import { loadConfig } from "../../src/config";
import { createApp } from "../../src/http/router";
import type { Runner } from "../../src/review/runner.service";
import { Settings, seedFromConfig } from "../../src/settings";
import { Store } from "../../src/store";
import { INTERNAL, req } from "./helpers";
import { viewOf } from "./public/helpers";

const env = {
  GITHUB_WEBHOOK_SECRET: "s",
  GITHUB_APP_ID: "7",
  GITHUB_APP_PRIVATE_KEY: "k",
  CUJO_MODEL: "p/m",
  MODEL_PROVIDER_NAME: "p",
  MODEL_PROVIDER_BASE_URL: "https://llm.example/v1",
  MODEL_PROVIDER_API_KEY: "sk-secret-1234",
  MODEL_PROVIDER_MODELS: "m=vendor/m",
};

function build(
  options: {
    installations?: OAuthInstallation[];
    orgRole?: "admin" | "member" | null;
    owner?: boolean;
    /** The repository's own files at its default branch, by path. */
    files?: Record<string, string>;
    /** GitHub does not answer for the file. */
    githubDown?: boolean;
  } = {},
) {
  const store = new Store(":memory:");
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
  const settings = Settings.open(store.settings, seedFromConfig(loadConfig(env)), log);
  // `view` answers for any run in the store, public or not, which is what
  // the owner plane serves (decision 159); the public plane filters on top.
  const listeners = new Map<string, Set<(view: unknown) => void>>();
  const runner = {
    view: (id: string) => {
      const run = store.runs.getRun(id);
      return run ? viewOf(run) : null;
    },
    changes: {
      on: (id: string, fn: (view: unknown) => void) => {
        listeners.set(id, (listeners.get(id) ?? new Set()).add(fn));
      },
      off: (id: string, fn: (view: unknown) => void) => listeners.get(id)?.delete(fn),
    },
    start: vi.fn(),
  } as unknown as Runner;
  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const github = {
    declaredMode: vi.fn(async () => {
      if (options.githubDown) throw new Error("GitHub 502");
      const yaml = files.get(".cujo.yml");
      return yaml ? (yaml.includes("diff") ? ("diff" as const) : ("sandbox" as const)) : null;
    }),
    readFile: vi.fn(async (_repo: string, path: string) => files.get(path) ?? null),
    appState: vi.fn(async () => {
      if (options.githubDown) throw new Error("GitHub 502");
      return {
        app: {
          slug: "cujo-guard",
          name: "Cujo",
          htmlUrl: "https://github.com/apps/cujo-guard",
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "write",
            checks: "read",
            issues: "read",
          },
          events: ["pull_request"],
        },
        installations: [
          {
            id: 10,
            account: { login: "octocat", type: "User" },
            suspended: false,
            repositorySelection: "selected",
            permissions: {},
            events: [],
          },
        ],
        deliveries: [
          {
            id: 1,
            event: "pull_request",
            action: "opened",
            deliveredAt: "2026-09-16T10:00:00Z",
            status: "OK",
            statusCode: 202,
            durationS: 0.3,
            redelivery: false,
          },
        ],
      };
    }),
  };
  const oauth = {
    authorizeUrl: (state: string, redirect: string) =>
      `https://github.com/login/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
    exchangeCode: vi.fn(async (code: string) =>
      code === "good" ? "ghu_tok" : Promise.reject(new Error("bad code")),
    ),
    user: vi.fn(async () => ({ login: "octocat", id: 1 })),
    installations: vi.fn(
      async () =>
        options.installations ?? [
          { id: 10, appId: 7, account: { login: "octocat", id: 1, type: "User" as const } },
        ],
    ),
    orgRole: vi.fn(async () => options.orgRole ?? null),
  };
  const base = {
    log,
    internalHost: INTERNAL,
    webhookHost: "hook.example",
    public: { runs: store.runs, runner, streamLimit: 200 },
    webhook: {
      log,
      secret: "s",
      github: {} as GitHubReader,
      store: store.runs,
      runner,
      createSession: async () => "sess",
      reviewRunId: () => "",
    },
  };
  const app = createApp(
    options.owner === false
      ? base
      : {
          ...base,
          owner: {
            oauth,
            appId: 7,
            redirectUri: "https://board.example/api/auth/callback",
            sessions: store.webSessions,
            settings,
            repositories: store.repositories,
            repositorySettings: store.repositorySettings,
            github,
            health: () => ({ harness: "ready" as const, store: "ok" as const, uptimeMs: 1234 }),
            runs: store.runs,
            runner,
            streamLimit: 1,
            log,
          },
        },
  );
  const call = (path: string, init: RequestInit = {}, session?: string) =>
    app.fetch(
      req(INTERNAL, path, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(session ? { authorization: `Bearer ${session}` } : {}),
          ...(init.headers ?? {}),
        },
      }),
    );
  const signIn = async () => {
    const start = (await (await call("/auth/login", { method: "POST" })).json()) as { url: string };
    const state = new URL(start.url).searchParams.get("state") ?? "";
    const res = await call("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ code: "good", state }),
    });
    return (await res.json()) as {
      ok: boolean;
      session?: string;
      login?: string;
      is_owner?: boolean;
    };
  };
  return {
    app,
    store,
    settings,
    oauth,
    call,
    signIn,
    logged: (e: string) => lines.filter((l) => l.event === e),
  };
}

describe("sign-in", () => {
  it("starts with a state only this process knows, and finishes into an owner session", async () => {
    const h = build();
    const start = await h.call("/auth/login", { method: "POST" });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    expect(url).toContain("redirect_uri=https%3A%2F%2Fboard.example%2Fapi%2Fauth%2Fcallback");
    const done = await h.signIn();
    expect(done).toMatchObject({ ok: true, login: "octocat", is_owner: true });
    expect(done.session).toMatch(/^[0-9a-f]{64}$/);
    expect(h.logged("auth.login.completed")).toMatchObject([
      { actor: "octocat", is_owner: true, count: 1 },
    ]);
    // The token was used and not kept anywhere.
    expect(JSON.stringify(h.store.webSessions.get(done.session ?? "", new Date()))).not.toContain(
      "ghu_tok",
    );
  });

  it("refuses a state it did not issue, a state used twice, and a code GitHub rejects", async () => {
    const h = build();
    const forged = await h.call("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ code: "good", state: "forged" }),
    });
    expect(forged.status).toBe(400);
    const start = (await (await h.call("/auth/login", { method: "POST" })).json()) as {
      url: string;
    };
    const state = new URL(start.url).searchParams.get("state") ?? "";
    const bad = await h.call("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ code: "bad", state }),
    });
    expect(bad.status).toBe(502);
    // The state was consumed by the failed attempt.
    const again = await h.call("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ code: "good", state }),
    });
    expect(again.status).toBe(400);
    expect(h.logged("auth.login.refused").map((l) => l.reason)).toEqual([
      "state",
      "github",
      "state",
    ]);
    expect((await h.call("/auth/callback", { method: "POST", body: "{nope" })).status).toBe(400);
  });

  it("signs a non-owner in as a non-owner, and logout ends the session", async () => {
    const h = build({
      installations: [
        { id: 12, appId: 7, account: { login: "acme", id: 2, type: "Organization" } },
      ],
      orgRole: "member",
    });
    const done = await h.signIn();
    expect(done).toMatchObject({ ok: true, is_owner: false });
    expect((await h.call("/owner/me", {}, done.session)).status).toBe(403);
    const out = await h.call("/auth/logout", { method: "POST" }, done.session);
    expect(await out.json()).toEqual({ ok: true, ended: true });
    expect((await h.call("/owner/me", {}, done.session)).status).toBe(401);
  });
});

describe("the owner plane", () => {
  it("is 401 without a session, 404 for an unknown route, and absent without the client", async () => {
    const h = build();
    expect((await h.call("/owner/me")).status).toBe(401);
    expect((await h.call("/owner/me", {}, "f".repeat(64))).status).toBe(401);
    expect((await h.call("/owner/me", { headers: { authorization: "Bearer short" } })).status).toBe(
      401,
    );
    const { session } = await h.signIn();
    expect((await h.call("/owner/nothing", {}, session)).status).toBe(404);
    const off = build({ owner: false });
    expect((await off.call("/auth/login", { method: "POST" })).status).toBe(404);
    expect((await off.call("/owner/me")).status).toBe(404);
  });

  it("answers who is signed in", async () => {
    const h = build();
    const { session } = await h.signIn();
    const me = await h.call("/owner/me", {}, session);
    expect(await me.json()).toMatchObject({ ok: true, login: "octocat", is_owner: true });
  });

  it("shows settings with the key masked, and changes them validated as a whole", async () => {
    const h = build();
    const { session } = await h.signIn();
    const shown = (await (await h.call("/owner/settings", {}, session)).json()) as {
      settings: { modelProvider: { apiKey: string } };
      sources: Record<string, string>;
    };
    expect(shown.settings.modelProvider.apiKey).toBe("****1234");
    expect(shown.sources.model).toBe("seed");
    // A bad second key leaves the good first one unapplied.
    const bad = await h.call(
      "/owner/settings",
      { method: "PATCH", body: JSON.stringify({ reviewMode: "diff", diffBudgetTokens: -5 }) },
      session,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("diffBudgetTokens"),
    });
    expect(h.settings.current().reviewMode).toBe("sandbox");
    const ok = await h.call(
      "/owner/settings",
      { method: "PATCH", body: JSON.stringify({ reviewMode: "diff", model: "p/other" }) },
      session,
    );
    expect(ok.status).toBe(200);
    expect(h.settings.current()).toMatchObject({ reviewMode: "diff", model: "p/other" });
    expect(h.settings.sources().reviewMode).toBe("owner");
    expect(
      (
        await h.call(
          "/owner/settings",
          { method: "PATCH", body: JSON.stringify({ port: 1 }) },
          session,
        )
      ).status,
    ).toBe(400);
    expect(h.logged("owner.settings.changed")).toMatchObject([{ actor: "octocat", count: 2 }]);
  });

  it("keeps the real key when the board sends the masked one back", async () => {
    const h = build();
    const { session } = await h.signIn();
    const provider = { ...h.settings.current().modelProvider, apiKey: "****1234", name: "renamed" };
    const res = await h.call(
      "/owner/settings",
      { method: "PATCH", body: JSON.stringify({ modelProvider: provider }) },
      session,
    );
    expect(res.status).toBe(200);
    expect(h.settings.current().modelProvider).toMatchObject({
      name: "renamed",
      apiKey: "sk-secret-1234",
    });
    const fresh = { ...provider, apiKey: "sk-new" };
    await h.call(
      "/owner/settings",
      { method: "PATCH", body: JSON.stringify({ modelProvider: fresh }) },
      session,
    );
    expect(h.settings.current().modelProvider?.apiKey).toBe("sk-new");
  });

  it("shows a repository's three layers and which wins, and writes the board's", async () => {
    const h = build({ files: { ".cujo.yml": "mode: diff\n" } });
    const { session } = await h.signIn();
    h.store.repositories.upsertInstalled(
      [{ repo: "o/r", installationId: 10, isPrivate: false }],
      "t0",
    );
    const before = (await (
      await h.call("/owner/repositories/o/r/settings", {}, session)
    ).json()) as Record<string, unknown>;
    expect(before).toMatchObject({
      ok: true,
      board: { mode: null, instructions: null },
      file: { mode: "diff", instructions: null },
      instance: { mode: "sandbox" },
      effective: { mode: { value: "diff", source: "file" }, instructions: null },
    });
    const down = build({ githubDown: true });
    const { session: s2 } = await down.signIn();
    down.store.repositories.upsertInstalled(
      [{ repo: "o/r", installationId: 10, isPrivate: false }],
      "t0",
    );
    expect((await down.call("/owner/repositories/o/r/settings", {}, s2)).status).toBe(502);
    expect(down.logged("owner.repository.file.failed")).toHaveLength(1);
    const set = await h.call(
      "/owner/repositories/o/r/settings",
      { method: "PATCH", body: JSON.stringify({ mode: "sandbox", instructions: "Ignore docs/." }) },
      session,
    );
    expect(set.status).toBe(200);
    const after = (await (
      await h.call("/owner/repositories/o/r/settings", {}, session)
    ).json()) as Record<string, unknown>;
    // The file still wins for mode; the board's instructions stand alone.
    expect(after).toMatchObject({
      board: { mode: "sandbox", instructions: "Ignore docs/." },
      effective: {
        mode: { value: "diff", source: "file" },
        instructions: { text: "Ignore docs/.", truncated: false, source: "board" },
      },
    });
    expect(h.store.repositorySettings.get("o/r")).toMatchObject({
      mode: "sandbox",
      instructions: "Ignore docs/.",
    });
    // Clearing, refusing, and an unknown repository.
    await h.call(
      "/owner/repositories/o/r/settings",
      { method: "PATCH", body: JSON.stringify({ instructions: "  " }) },
      session,
    );
    expect(h.store.repositorySettings.get("o/r").instructions).toBeNull();
    expect(
      (
        await h.call(
          "/owner/repositories/o/r/settings",
          { method: "PATCH", body: JSON.stringify({ mode: "fast" }) },
          session,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call(
          "/owner/repositories/o/r/settings",
          { method: "PATCH", body: JSON.stringify({}) },
          session,
        )
      ).status,
    ).toBe(400);
    expect((await h.call("/owner/repositories/o/none/settings", {}, session)).status).toBe(404);
    expect(h.logged("owner.repository.settings.changed")).toHaveLength(2);
  });

  it("shows the App beside what the reviews need from it, and the process's readiness", async () => {
    const h = build();
    const { session } = await h.signIn();
    h.store.repositories.upsertInstalled(
      [
        { repo: "o/r", installationId: 10, isPrivate: false },
        { repo: "o/gone", installationId: 10, isPrivate: false },
      ],
      "t0",
    );
    h.store.repositories.markRemoved(["o/gone"], "t1");
    const bot = (await (await h.call("/owner/bot", {}, session)).json()) as Record<string, unknown>;
    expect(bot).toMatchObject({
      ok: true,
      app: { slug: "cujo-guard" },
      installations: [{ id: 10, repositories: 1 }],
      deliveries: [{ id: 1, statusCode: 202 }],
    });
    const permissions = bot.permissions as {
      name: string;
      needed: string;
      held: string | null;
      ok: boolean;
    }[];
    expect(permissions.find((p) => p.name === "checks")).toEqual({
      name: "checks",
      needed: "write",
      held: "read",
      ok: false,
    });
    expect(permissions.find((p) => p.name === "pull_requests")).toEqual({
      name: "pull_requests",
      needed: "write",
      held: "write",
      ok: true,
    });
    const health = await (await h.call("/owner/health", {}, session)).json();
    expect(health).toEqual({
      ok: true,
      harness: "ready",
      store: "ok",
      uptimeMs: 1234,
      ready: true,
    });
    const down = build({ githubDown: true });
    const { session: s2 } = await down.signIn();
    expect((await down.call("/owner/bot", {}, s2)).status).toBe(502);
    expect(down.logged("owner.bot.read.failed")).toHaveLength(1);
  });

  it("lists the registry and flips a repository's switch", async () => {
    const h = build();
    const { session } = await h.signIn();
    h.store.repositories.upsertInstalled(
      [{ repo: "O/R", installationId: 10, isPrivate: false }],
      "t0",
    );
    const list = (await (await h.call("/owner/repositories", {}, session)).json()) as {
      repositories: { repo: string; enabled: boolean }[];
    };
    expect(list.repositories).toMatchObject([{ repo: "o/r", enabled: true }]);
    const off = await h.call(
      "/owner/repositories/O/R",
      { method: "PATCH", body: JSON.stringify({ enabled: false }) },
      session,
    );
    expect(await off.json()).toMatchObject({
      ok: true,
      repository: { repo: "o/r", enabled: false },
    });
    expect(h.store.repositories.isDisabled("o/r")).toBe(true);
    expect(
      (
        await h.call(
          "/owner/repositories/o/none",
          { method: "PATCH", body: JSON.stringify({ enabled: true }) },
          session,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call(
          "/owner/repositories/o/r",
          { method: "PATCH", body: JSON.stringify({ enabled: "yes" }) },
          session,
        )
      ).status,
    ).toBe(400);
    expect(h.logged("owner.repository.changed")).toMatchObject([
      { actor: "octocat", repo: "O/R", enabled: false },
    ]);
  });
});

describe("the owner plane serves every run (decision 159)", () => {
  function seed(store: Store) {
    const priv = store.runs.createRun({
      repo: "o/private",
      prNumber: 1,
      headSha: "p1",
      sessionId: "s-p",
      isPublic: false,
      model: "p/m",
      rubricSha256: "r",
    }).run;
    const pub = store.runs.createRun({
      repo: "o/public",
      prNumber: 2,
      headSha: "q1",
      sessionId: "s-q",
      isPublic: true,
      model: "p/m",
      rubricSha256: "r",
    }).run;
    return { priv, pub };
  }

  it("lists private runs beside public ones, and only for a session", async () => {
    const h = build();
    const { priv, pub } = seed(h.store);
    expect((await h.call("/owner/runs")).status).toBe(401);
    const { session } = await h.signIn();
    const res = await h.call("/owner/runs", {}, session);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { id: string; repo: string }[] };
    expect(body.runs.map((r) => r.id).sort()).toEqual([priv.id, pub.id].sort());
    // The public plane still hides the private one.
    const anon = (await (await h.call("/public/runs")).json()) as { runs: { id: string }[] };
    expect(anon.runs.map((r) => r.id)).toEqual([pub.id]);
  });

  it("serves a private run's page and stream, where the public plane says 404", async () => {
    const h = build();
    const { priv } = seed(h.store);
    const { session } = await h.signIn();
    expect((await h.call(`/public/runs/${priv.id}`)).status).toBe(404);
    expect((await h.call(`/owner/runs/${priv.id}`)).status).toBe(401);
    const res = await h.call(`/owner/runs/${priv.id}`, {}, session);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { repo: string }).repo).toBe("o/private");
    const stream = await h.call(`/owner/runs/${priv.id}/events`, {}, session);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    const first = new TextDecoder().decode((await reader?.read())?.value);
    expect(first).toContain("event: run");
    expect(first).toContain('"repo":"o/private"');
    await reader?.cancel();
  });

  it("is 404 for a run that does not exist, and 503 past its own stream limit", async () => {
    const h = build();
    const { priv } = seed(h.store);
    const { session } = await h.signIn();
    expect((await h.call("/owner/runs/nope", {}, session)).status).toBe(404);
    const first = await h.call(`/owner/runs/${priv.id}/events`, {}, session);
    expect(first.status).toBe(200);
    const second = await h.call(`/owner/runs/${priv.id}/events`, {}, session);
    expect(second.status).toBe(503);
    expect(h.logged("owner.stream.rejected").length).toBe(1);
    await first.body?.cancel();
  });
});
