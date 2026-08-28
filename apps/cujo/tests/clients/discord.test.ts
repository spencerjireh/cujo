import { describe, expect, it, vi } from "vitest";
import {
  DiscordClient,
  DiscordError,
  REQUIRED_PERMISSIONS,
  SEND_MESSAGES,
  UNKNOWN_MESSAGE,
  effectivePermissions,
  hasPermissions,
} from "../../src/clients/discord";
import type { DiscordMessagePayload } from "../../src/notify/card";

const TOKEN = "bot-token-do-not-log";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Route = (call: Call) => { status?: number; body: unknown };

function fakeFetch(route: Route) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = {
      method: init?.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bot ${TOKEN}`);
    const { status = 200, body } = route(call);
    return new Response(JSON.stringify(body), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const payload: DiscordMessagePayload = { content: "hi", allowed_mentions: { parse: [] } };

describe("DiscordClient", () => {
  it("creates a message on the channel and returns its id", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { id: "m1" } }));
    const created = await new DiscordClient(TOKEN, impl).createMessage("c1", payload);
    expect(created.id).toBe("m1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v10/channels/c1/messages",
      body: payload,
    });
  });

  it("edits an existing message", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { id: "m1" } }));
    await new DiscordClient(TOKEN, impl).editMessage("c1", "m1", payload);
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/api/v10/channels/c1/messages/m1",
    });
  });

  it("reads a channel, the guilds, the channels and the roles", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: [] }));
    const client = new DiscordClient(TOKEN, impl);
    await client.getChannel("c1").catch(() => undefined);
    await client.listGuilds();
    await client.listChannels("g1");
    await client.listRoles("g1");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v10/channels/c1",
      "/api/v10/users/@me/guilds?limit=200",
      "/api/v10/guilds/g1/channels",
      "/api/v10/guilds/g1/roles",
    ]);
  });

  it("throws a status-only error that carries neither the token nor the body", async () => {
    const { impl } = fakeFetch(() => ({ status: 403, body: { message: "Missing Access" } }));
    const error = await new DiscordClient(TOKEN, impl)
      .createMessage("c1", payload)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscordError);
    expect((error as DiscordError).message).toBe("Discord POST /channels/c1/messages returned 403");
    expect((error as DiscordError).message).not.toContain(TOKEN);
    expect((error as DiscordError).message).not.toContain("Missing Access");
    expect((error as DiscordError).status).toBe(403);
  });

  it("converts retry_after from fractional seconds to milliseconds", async () => {
    const { impl } = fakeFetch(() => ({ status: 429, body: { retry_after: 0.75, global: false } }));
    const error = (await new DiscordClient(TOKEN, impl)
      .createMessage("c1", payload)
      .catch((e: unknown) => e)) as DiscordError;
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(750);
  });

  it("surfaces the Unknown Message code so a deleted card can be reposted", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: { code: UNKNOWN_MESSAGE } }));
    const error = (await new DiscordClient(TOKEN, impl)
      .editMessage("c1", "m1", payload)
      .catch((e: unknown) => e)) as DiscordError;
    expect(error.code).toBe(UNKNOWN_MESSAGE);
  });
});

describe("effectivePermissions", () => {
  const GUILD = "222222222222222222";
  const ME = "777777777777777777";
  const ROLE = "333333333333333333";
  const base = {
    guildId: GUILD,
    memberId: ME,
    memberRoles: [ROLE],
    roles: [
      { id: GUILD, name: "@everyone", permissions: String(REQUIRED_PERMISSIONS) },
      { id: ROLE, name: "bots", permissions: "0" },
    ],
    overwrites: [],
  };

  it("unions the roles the bot holds, @everyone included", () => {
    expect(hasPermissions(effectivePermissions(base), REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("lets a channel deny take a permission the roles granted", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [{ id: ROLE, type: 0, allow: "0", deny: String(SEND_MESSAGES) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(false);
  });

  it("applies the member overwrite last, so it can grant back what a role denied", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [
        { id: ROLE, type: 0, allow: "0", deny: String(SEND_MESSAGES) },
        { id: ME, type: 1, allow: String(SEND_MESSAGES), deny: "0" },
      ],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("ignores an overwrite for a role the bot does not hold", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [{ id: "444444444444444444", type: 0, allow: "0", deny: String(SEND_MESSAGES) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("short-circuits on administrator, which no overwrite can take away", () => {
    const permissions = effectivePermissions({
      ...base,
      roles: [
        { id: GUILD, name: "@everyone", permissions: "0" },
        { id: ROLE, name: "admin", permissions: String(1n << 3n) },
      ],
      overwrites: [{ id: ROLE, type: 0, allow: "0", deny: String(REQUIRED_PERMISSIONS) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("grants nothing when no role carries the bits", () => {
    const permissions = effectivePermissions({
      ...base,
      roles: [
        { id: GUILD, name: "@everyone", permissions: "0" },
        { id: ROLE, name: "bots", permissions: "0" },
      ],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(false);
  });
});
