/**
 * "Can Cujo actually post a card in that channel, and does that role exist?"
 *
 * One rule, asked from two places: an operator binding a repo over the
 * Access-gated API, and a server admin running `/cujo watch`. It was written
 * twice and had already drifted — the API turned a failed permission lookup
 * into a 400 while the command let it escape to a generic "something went
 * wrong" — so it is stated once here and the callers only choose the wording.
 *
 * The refusal is a typed reason rather than a message. The API answers JSON to
 * a machine and the command answers prose to a person who needs to know what
 * to fix, and neither should have to phrase things the other's way.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { DiscordClient } from "../clients/discord";
import { GUILD_ANNOUNCEMENT, GUILD_TEXT } from "../clients/discord";
import {
  REQUIRED_PERMISSIONS,
  effectivePermissions,
  hasPermissions,
} from "../clients/discord-permissions";

export type ChannelRefusal =
  | "unreadable_channel"
  | "not_a_text_channel"
  | "wrong_guild"
  | "unreadable_roles"
  | "no_such_role"
  | "unreadable_permissions"
  | "missing_permissions";

export type ChannelCheck =
  | { ok: true; guildId: string; channelName: string | null }
  | { ok: false; reason: ChannelRefusal };

export interface ChannelCheckInput {
  channelId: string;
  /** Null or absent means "no ping role", not "any role". */
  roleId?: string | null;
  /**
   * The server the channel must belong to. The command passes it, because the
   * option comes from a picker but a crafted interaction could name a channel
   * anywhere. The operator API omits it and takes whichever server the channel
   * turns out to be in, which is the answer it is asking for.
   */
  expectGuildId?: string;
}

export async function checkChannel(
  discord: DiscordClient,
  input: ChannelCheckInput,
  log: Logger,
): Promise<ChannelCheck> {
  // 403 and 404 are deliberately the same answer: telling them apart would let
  // a caller probe channels across all of Discord.
  const channel = await discord.getChannel(input.channelId).catch((error) => {
    log.warn("discord.channel.unreadable", {
      channel_id: input.channelId,
      reason: "get_channel",
      ...errorFields(error),
    });
    return null;
  });
  if (!channel) return { ok: false, reason: "unreadable_channel" };
  if (channel.type !== GUILD_TEXT && channel.type !== GUILD_ANNOUNCEMENT) {
    return { ok: false, reason: "not_a_text_channel" };
  }
  const guildId = channel.guild_id;
  if (!guildId) return { ok: false, reason: "not_a_text_channel" };
  if (input.expectGuildId && guildId !== input.expectGuildId) {
    return { ok: false, reason: "wrong_guild" };
  }

  const roles = await discord.listRoles(guildId).catch(() => null);
  if (!roles) return { ok: false, reason: "unreadable_roles" };
  // Otherwise the ping would mention nobody and say nothing about it.
  if (input.roleId && !roles.some((r) => r.id === input.roleId)) {
    return { ok: false, reason: "no_such_role" };
  }

  // Reading a channel does not mean the bot may post an embed in it. A
  // channel-level deny would otherwise bind cleanly and then fail on every
  // run, which is the silent failure this whole check exists to prevent.
  const permissions = await (async () => {
    const me = await discord.currentUser();
    const member = await discord.guildMember(guildId, me.id);
    return effectivePermissions({
      guildId,
      memberId: me.id,
      memberRoles: member.roles,
      roles,
      overwrites: channel.permission_overwrites ?? [],
    });
  })().catch((error) => {
    log.warn("discord.channel.unreadable", {
      channel_id: input.channelId,
      reason: "permissions",
      ...errorFields(error),
    });
    return null;
  });
  if (permissions === null) return { ok: false, reason: "unreadable_permissions" };
  if (!hasPermissions(permissions, REQUIRED_PERMISSIONS)) {
    return { ok: false, reason: "missing_permissions" };
  }

  return { ok: true, guildId, channelName: channel.name ?? null };
}
