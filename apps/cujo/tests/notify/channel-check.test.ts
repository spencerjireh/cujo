import { describe, expect, it, vi } from "vitest";
import type { DiscordClient } from "../../src/clients/discord";
import { checkChannel } from "../../src/notify/channel-check";

/** View Channel + Send Messages + Embed Links: what posting a card needs. */
const CAN_POST = String((1n << 10n) | (1n << 11n) | (1n << 14n));
const GUILD = "222222222222222222";
const CHANNEL = "111111111111111111";

function fakeDiscord(overrides: Record<string, unknown> = {}) {
  return {
    getChannel: vi.fn(async () => ({
      id: CHANNEL,
      type: 0,
      name: "reviews",
      guild_id: GUILD,
      permission_overwrites: [],
    })),
    currentUser: vi.fn(async () => ({ id: "777777777777777777" })),
    guildMember: vi.fn(async () => ({ roles: [] })),
    listRoles: vi.fn(async () => [{ id: GUILD, name: "@everyone", permissions: CAN_POST }]),
    ...overrides,
  } as unknown as DiscordClient;
}

describe("checkChannel", () => {
  it("reports the guild and channel name the caller has to store", async () => {
    const result = await checkChannel(fakeDiscord(), { channelId: CHANNEL });
    expect(result).toEqual({ ok: true, guildId: GUILD, channelName: "reviews" });
  });

  it("refuses a channel in another server only when one was asserted", async () => {
    // The operator API asks which server the channel is in; the slash command
    // already knows, and has to be told when a crafted option disagrees.
    expect(await checkChannel(fakeDiscord(), { channelId: CHANNEL, expectGuildId: "999" })).toEqual(
      { ok: false, reason: "wrong_guild" },
    );
    expect((await checkChannel(fakeDiscord(), { channelId: CHANNEL })).ok).toBe(true);
  });

  /**
   * The behaviour the two copies disagreed on. The operator API turned a failed
   * permission lookup into a 400; the slash command let it escape to a generic
   * "something went wrong". Unified on the typed refusal, so neither caller has
   * to catch anything.
   */
  it("turns a failed permission lookup into a refusal rather than throwing", async () => {
    const discord = fakeDiscord({
      currentUser: vi.fn(async () => {
        throw new Error("Discord GET /users/@me returned 500");
      }),
    });
    await expect(checkChannel(discord, { channelId: CHANNEL })).resolves.toEqual({
      ok: false,
      reason: "unreadable_permissions",
    });
  });

  it("refuses a role that is not in the server, and allows no role at all", async () => {
    expect(await checkChannel(fakeDiscord(), { channelId: CHANNEL, roleId: "999" })).toEqual({
      ok: false,
      reason: "no_such_role",
    });
    expect((await checkChannel(fakeDiscord(), { channelId: CHANNEL, roleId: null })).ok).toBe(true);
  });
});
