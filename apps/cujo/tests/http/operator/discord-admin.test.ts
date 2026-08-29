import { describe, expect, it, vi } from "vitest";
import type { DiscordClient } from "../../../src/clients/discord";
import type { GitHubReader } from "../../../src/clients/github";
import { AUTH, build } from "./helpers";

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

describe("operator Discord admin API", () => {
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
    expect(store.notifications.getDiscordChannel("o/r")?.channelId).toBe("111111111111111111");
  });

  it("lists the bindings and says whether Discord is configured at all", async () => {
    const { app, store } = build(null);
    store.notifications.putDiscordChannel({
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
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
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
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
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
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
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
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
  });

  it("deletes a binding, and answers 404 when there was none", async () => {
    const { app, store } = build(null);
    store.notifications.putDiscordChannel({
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
      authorized_by: "operator",
    });
    expect(store.notifications.isGuildAuthorized("222222222222222222", "o/r")).toBe(true);
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
    expect(store.notifications.listGuildRepos()).toHaveLength(0);
  });

  it("refuses to authorize a server the bot is not in", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    const res = await app.request("/discord/authorizations/999999999999999999/o/r", {
      method: "PUT",
      headers: AUTH,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "the bot is not in that server" });
    expect(store.notifications.listGuildRepos()).toHaveLength(0);
  });

  it("lists and revokes authorizations", async () => {
    const { app, store } = build(null, fakeDiscord() as unknown as DiscordClient);
    store.notifications.authorizeGuildRepo({
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
