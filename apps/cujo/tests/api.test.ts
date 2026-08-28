import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { apiRoutes } from "../src/api";
import type { DiscordClient } from "../src/discord";
import { emptyProjection } from "../src/folder";
import type { GitHubReader } from "../src/github";
import type { RunView, Runner } from "../src/runner";
import { Store } from "../src/store";

const AUTH = { "cf-access-jwt-assertion": "good" };

function build(view: RunView | null, discord?: DiscordClient, github?: GitHubReader) {
  const store = new Store(":memory:");
  const changes = new EventEmitter();
  const runner = {
    changes,
    view: vi.fn(() => view),
    approve: vi.fn(async () => ({ ok: true as const })),
  } as unknown as Runner;
  const app = apiRoutes({
    store,
    runner,
    verify: async (t) => (t === "good" ? "op@example.com" : null),
    ...(discord ? { discord } : {}),
    ...(github ? { github } : {}),
  });
  return { app, store, runner, changes };
}

/** View Channel + Send Messages + Embed Links: what posting a card needs. */
const CAN_POST = String((1n << 10n) | (1n << 11n) | (1n << 14n));

/** A text channel in a guild the bot can post in, which a binding requires. */
function fakeDiscord(overrides: Record<string, unknown> = {}) {
  return {
    getChannel: vi.fn(async () => ({
      id: "111111111111111111",
      type: 0,
      name: "reviews",
      guild_id: "222222222222222222",
      permission_overwrites: [],
    })),
    currentUser: vi.fn(async () => ({ id: "777777777777777777" })),
    guildMember: vi.fn(async () => ({ roles: ["333333333333333333"] })),
    listRoles: vi.fn(async () => [
      { id: "222222222222222222", name: "@everyone", permissions: CAN_POST },
      { id: "333333333333333333", name: "oncall", permissions: "0" },
    ]),
    listGuilds: vi.fn(async () => [{ id: "222222222222222222", name: "My Server" }]),
    listChannels: vi.fn(async () => [
      { id: "444444444444444444", name: "voice", type: 2, position: 0 },
      { id: "555555555555555555", name: "category", type: 4, position: 1 },
      { id: "111111111111111111", name: "reviews", type: 0, position: 3, parent_id: "c0" },
      { id: "666666666666666666", name: "announce", type: 5, position: 2 },
    ]),
    ...overrides,
  };
}

const PUT_JSON = { ...AUTH, "content-type": "application/json" };

function put(body: unknown): RequestInit {
  return { method: "PUT", headers: PUT_JSON, body: JSON.stringify(body) };
}

function blockedView(): RunView {
  const projection = emptyProjection();
  projection.status = "blocked_pending";
  projection.turnIds = ["t1"];
  projection.checks = [
    {
      threadId: "th",
      title: "tests",
      isCheck: true,
      startedAt: null,
      endedAt: null,
      status: "done",
      report: { ok: 1 },
      error: null,
    },
  ];
  projection.review = {
    tool: "post_blocking_review",
    toolCallId: "c1",
    body: "b",
    comments: [{ path: "a.py", line: 3, body: "off by one" }],
    findings: [],
  };
  projection.hardRuleHits = [
    {
      source: "hard_rule",
      check: "tests",
      severity: "critical",
      title: "1 test passes on base and fails on head",
      evidence: "t_a",
    },
  ];
  projection.findings = [
    ...projection.hardRuleHits,
    { source: "agent", check: "smoke", severity: "info", title: "boots", evidence: "200" },
  ];
  projection.approval = { threadId: "main", toolCallId: "c1", sourceEventId: "mm-1" };
  return {
    run: {
      id: "r1",
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      turnIds: ["t1"],
      status: "blocked_pending",
      approver: null,
      decidedAt: null,
      createdAt: "2026-08-27T00:00:00Z",
      updatedAt: "2026-08-27T00:00:00Z",
    },
    projection,
  };
}

describe("api", () => {
  it("lists runs in the flat shape", async () => {
    const { app, store } = build(null);
    const { run } = store.createRun({ repo: "o/r", prNumber: 7, headSha: "h", sessionId: "s" });
    const res = await app.request("/runs", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [
        {
          id: run.id,
          repo: "o/r",
          pr_number: 7,
          head_sha: "h",
          status: "running",
          approver: null,
          created_at: run.createdAt,
          updated_at: run.updatedAt,
        },
      ],
    });
  });

  it("serializes a run with its checks, findings, and pending approval", async () => {
    const { app } = build(blockedView());
    const res = await app.request("/runs/r1", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "r1",
      status: "blocked_pending",
      turn_ids: ["t1"],
      findings: [
        { source: "hard_rule", severity: "critical", check: "tests" },
        { source: "agent", severity: "info", check: "smoke" },
      ],
      hard_rule_hits: [{ severity: "critical" }],
      review: { comments: [{ path: "a.py", line: 3, body: "off by one" }] },
      approval: { threadId: "main", toolCallId: "c1" },
      external_resume: false,
    });
    expect((body.checks as unknown[]).length).toBe(1);
  });

  it("hides the approval once the run is no longer blocked_pending", async () => {
    const view = blockedView();
    view.run.status = "superseded";
    const { app } = build(view);
    const body = (await (await app.request("/runs/r1", { headers: AUTH })).json()) as {
      approval: unknown;
    };
    expect(body.approval).toBeNull();
  });

  it("answers 404 for an unknown run on both read routes", async () => {
    const { app } = build(null);
    expect((await app.request("/runs/nope", { headers: AUTH })).status).toBe(404);
    expect((await app.request("/runs/nope/events", { headers: AUTH })).status).toBe(404);
  });

  it("streams the current view first, then every change", async () => {
    const view = blockedView();
    const { app, changes } = build(view);
    const res = await app.request("/runs/r1/events", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    const readFrame = async () => decoder.decode((await reader.read()).value);

    const first = await readFrame();
    expect(first).toContain("event: run");
    expect(first).toContain("id: 0");
    expect(first).toContain('"status":"blocked_pending"');

    const next = { ...view, run: { ...view.run, status: "blocked_posted" as const } };
    changes.emit("r1", next);
    const second = await readFrame();
    expect(second).toContain("id: 1");
    expect(second).toContain('"status":"blocked_posted"');
    await reader.cancel();
  });

  it("passes the approver's email into the decision", async () => {
    const { app, runner } = build(blockedView());
    const res = await app.request("/runs/r1/approve", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ decision: "deny" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: "deny", approver: "op@example.com" });
    expect(runner.approve).toHaveBeenCalledWith("r1", "deny", "op@example.com");
  });

  it("treats an unparseable body as a bad decision", async () => {
    const { app } = build(blockedView());
    const res = await app.request("/runs/r1/approve", {
      method: "POST",
      headers: AUTH,
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("api discord routes", () => {
  it("requires an Access assertion like every other operator route", async () => {
    const { app } = build(null, fakeDiscord() as unknown as DiscordClient);
    expect((await app.request("/discord/channels")).status).toBe(401);
    expect((await app.request("/discord/guilds")).status).toBe(401);
  });

  it("binds a repo to a channel and stores what Discord reported", async () => {
    const discord = fakeDiscord();
    const { app, store } = build(null, discord as unknown as DiscordClient);
    const res = await app.request(
      "/discord/channels/O/R",
      put({ channel_id: "111111111111111111", notify_role_id: "333333333333333333" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      repo: "o/r",
      channel_id: "111111111111111111",
      guild_id: "222222222222222222",
      channel_name: "reviews",
      notify_role_id: "333333333333333333",
    });
    expect(discord.getChannel).toHaveBeenCalledWith("111111111111111111");
    // Stored lower-cased, so the webhook's repository.full_name matches it.
    expect(store.getDiscordChannel("o/r")?.channelId).toBe("111111111111111111");
  });

  it("lists the bindings and says whether Discord is configured at all", async () => {
    const { app, store } = build(null);
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "111111111111111111",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    const body = await (await app.request("/discord/channels", { headers: AUTH })).json();
    expect(body).toMatchObject({ configured: false, channels: [{ repo: "o/r" }] });
  });

  it("refuses a channel the bot cannot see, without saying which way it failed", async () => {
    const discord = fakeDiscord({
      getChannel: vi.fn(async () => {
        throw new Error("Discord GET /channels/x returned 403");
      }),
    });
    const { app, store } = build(null, discord as unknown as DiscordClient);
    const res = await app.request(
      "/discord/channels/o/r",
      put({ channel_id: "111111111111111111" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "the bot cannot see that channel" });
    expect(store.getDiscordChannel("o/r")).toBeNull();
  });

  it("refuses a channel the bot can read but cannot post an embed in", async () => {
    // Reading a channel says nothing about posting in it: a channel-level deny
    // would otherwise bind cleanly and then fail on every run.
    const denySend = String(1n << 11n);
    const discord = fakeDiscord({
      getChannel: vi.fn(async () => ({
        id: "111111111111111111",
        type: 0,
        name: "reviews",
        guild_id: "222222222222222222",
        permission_overwrites: [{ id: "333333333333333333", type: 0, allow: "0", deny: denySend }],
      })),
    });
    const { app, store } = build(null, discord as unknown as DiscordClient);
    const res = await app.request(
      "/discord/channels/o/r",
      put({ channel_id: "111111111111111111" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "the bot needs View Channel, Send Messages and Embed Links there",
    });
    expect(store.getDiscordChannel("o/r")).toBeNull();
  });

  it("refuses anything that is not a guild text channel", async () => {
    const discord = fakeDiscord({
      getChannel: vi.fn(async () => ({ id: "111111111111111111", type: 2, guild_id: "g" })),
    });
    const { app, store } = build(null, discord as unknown as DiscordClient);
    const res = await app.request(
      "/discord/channels/o/r",
      put({ channel_id: "111111111111111111" }),
    );
    expect(res.status).toBe(400);
    expect(store.getDiscordChannel("o/r")).toBeNull();
  });

  it("refuses a malformed id and a role that is not in the server", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    expect((await app.request("/discord/channels/o/r", put({ channel_id: "12" }))).status).toBe(
      400,
    );
    expect(
      (
        await app.request(
          "/discord/channels/o/r",
          put({ channel_id: "111111111111111111", notify_role_id: "nope" }),
        )
      ).status,
    ).toBe(400);
    const res = await app.request(
      "/discord/channels/o/r",
      put({ channel_id: "111111111111111111", notify_role_id: "999999999999999999" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "no such role in that server" });
    expect(store.getDiscordChannel("o/r")).toBeNull();
  });

  it("deletes a binding, and answers 404 when there was none", async () => {
    const { app, store } = build(null);
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "111111111111111111",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    const del = { method: "DELETE", headers: AUTH };
    expect((await app.request("/discord/channels/o/r", del)).status).toBe(200);
    expect((await app.request("/discord/channels/o/r", del)).status).toBe(404);
  });

  it("offers the guilds and their postable channels, in channel order", async () => {
    const { app } = build(null, fakeDiscord() as unknown as DiscordClient);
    const guilds = await (await app.request("/discord/guilds", { headers: AUTH })).json();
    expect(guilds).toEqual({ guilds: [{ id: "222222222222222222", name: "My Server" }] });

    const res = await app.request("/discord/guilds/222222222222222222/channels", {
      headers: AUTH,
    });
    const body = (await res.json()) as { channels: { name: string }[] };
    // Voice and category channels cannot take a message, so they are not offered.
    expect(body.channels.map((c) => c.name)).toEqual(["announce", "reviews"]);
  });

  it("authorizes a server for a repo, recording the operator's email", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    const res = await app.request("/discord/authorizations/222222222222222222/O/R", {
      method: "PUT",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      guild_id: "222222222222222222",
      guild_name: "My Server",
      repo: "o/r",
      authorized_by: "op@example.com",
    });
    expect(store.isGuildAuthorized("222222222222222222", "o/r")).toBe(true);
  });

  it("refuses to authorize a repo the Cujo App is not installed on", async () => {
    const { app, store } = build(
      null,
      fakeDiscord() as unknown as DiscordClient,
      { installedRepos: vi.fn(async () => ["spencerjireh/other"]) } as unknown as GitHubReader,
    );
    const res = await app.request("/discord/authorizations/222222222222222222/o/r", {
      method: "PUT",
      headers: AUTH,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "the Cujo App is not installed on that repo",
    });
    expect(store.listGuildRepos()).toHaveLength(0);
  });

  it("refuses to authorize a server the bot is not in", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    const res = await app.request("/discord/authorizations/999999999999999999/o/r", {
      method: "PUT",
      headers: AUTH,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "the bot is not in that server" });
    expect(store.listGuildRepos()).toHaveLength(0);
  });

  it("lists and revokes authorizations", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    store.authorizeGuildRepo({
      guildId: "222222222222222222",
      repo: "o/r",
      guildName: "My Server",
      authorizedBy: "op@example.com",
    });
    const listed = await (await app.request("/discord/authorizations", { headers: AUTH })).json();
    expect(listed).toMatchObject({ authorizations: [{ repo: "o/r", guild_name: "My Server" }] });

    const del = { method: "DELETE", headers: AUTH };
    expect((await app.request("/discord/authorizations/222222222222222222/o/r", del)).status).toBe(
      200,
    );
    expect((await app.request("/discord/authorizations/222222222222222222/o/r", del)).status).toBe(
      404,
    );
  });

  it("answers 503 on the routes that need Discord when no token is set", async () => {
    const { app } = build(null);
    expect(
      (await app.request("/discord/channels/o/r", put({ channel_id: "111111111111111111" })))
        .status,
    ).toBe(503);
    expect((await app.request("/discord/guilds", { headers: AUTH })).status).toBe(503);
    expect(
      (await app.request("/discord/guilds/222222222222222222/channels", { headers: AUTH })).status,
    ).toBe(503);
  });
});
