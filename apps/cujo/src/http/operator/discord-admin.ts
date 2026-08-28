/**
 * Discord administration for an operator (spec Contracts 7 and 8): which repo
 * notifies which channel, and which Discord server is allowed to manage a
 * repo's notifications at all.
 *
 * Mounted behind the Access gate in `index.ts`. That is the whole reason
 * authorizing a server lives here and not on the interactions endpoint: the
 * question "which repos may this server see" always carries the verified email
 * of the operator who answered it (decision 28).
 */

import { Hono } from "hono";
import { GUILD_ANNOUNCEMENT, GUILD_TEXT } from "../../clients/discord";
import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import { type ChannelRefusal, checkChannel } from "../../notify/channel-check";
import type { DiscordChannelRecord } from "../../notify/types";
import type { NotificationStore } from "../../store";
import type { Env } from "./access";

export interface DiscordAdminDeps {
  notifications: NotificationStore;
  /** Absent when DISCORD_BOT_TOKEN is unset; the Discord routes then 503. */
  discord?: DiscordClient;
  /** Used to check a repo is one the Cujo App can actually review. */
  github?: GitHubReader;
}

function serializeChannel(record: DiscordChannelRecord) {
  return {
    repo: record.repo,
    channel_id: record.channelId,
    guild_id: record.guildId,
    channel_name: record.channelName,
    notify_role_id: record.notifyRoleId,
    bound_by: record.boundBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

const SNOWFLAKE = /^\d{17,20}$/;
/** One path segment of `owner/name`; a slash in a single param is not worth it. */
const REPO_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * The shared channel rule's refusals, in this route's words. `wrong_guild`
 * cannot happen here: the route asks which server the channel is in rather
 * than asserting one, so no expectGuildId is passed.
 */
const REFUSALS: Record<ChannelRefusal, string> = {
  unreadable_channel: "the bot cannot see that channel",
  not_a_text_channel: "not a guild text channel",
  wrong_guild: "not a guild text channel",
  unreadable_roles: "could not read the server's roles",
  no_such_role: "no such role in that server",
  unreadable_permissions: "could not check the bot's permissions",
  missing_permissions: "the bot needs View Channel, Send Messages and Embed Links there",
};

export function discordAdminRoutes(deps: DiscordAdminDeps): Hono<Env> {
  const app = new Hono<Env>();

  // Contract 7. The repo-to-channel bindings. The bot token is never returned
  // here, masked or otherwise; `configured` is all the UI needs to know.
  app.get("/discord/channels", (c) =>
    c.json({
      configured: Boolean(deps.discord),
      channels: deps.notifications.listDiscordChannels().map(serializeChannel),
    }),
  );

  app.put("/discord/channels/:owner/:name", async (c) => {
    const discord = deps.discord;
    if (!discord) return c.json({ ok: false, error: "discord is not configured" }, 503);
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    if (!REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
      return c.json({ ok: false, error: "bad repo name" }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      channel_id?: unknown;
      notify_role_id?: unknown;
    };
    const channelId = body.channel_id;
    if (typeof channelId !== "string" || !SNOWFLAKE.test(channelId)) {
      return c.json({ ok: false, error: "channel_id must be a Discord id" }, 400);
    }
    const rawRole = body.notify_role_id ?? null;
    if (rawRole !== null && (typeof rawRole !== "string" || !SNOWFLAKE.test(rawRole))) {
      return c.json({ ok: false, error: "notify_role_id must be a Discord id or null" }, 400);
    }
    const notifyRoleId = rawRole as string | null;

    // Validate against Discord so a typo fails here rather than silently at
    // the first blocked run.
    const check = await checkChannel(discord, { channelId, roleId: notifyRoleId });
    if (!check.ok) return c.json({ ok: false, error: REFUSALS[check.reason] }, 400);

    const stored = deps.notifications.putDiscordChannel({
      repo: `${owner}/${name}`,
      channelId,
      guildId: check.guildId,
      channelName: check.channelName,
      notifyRoleId,
      boundBy: c.get("email"),
    });
    return c.json(serializeChannel(stored));
  });

  app.delete("/discord/channels/:owner/:name", (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!deps.notifications.deleteDiscordChannel(repo)) {
      return c.json({ ok: false, error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });

  // Contract 8, tier one. Which Discord server may manage which repo. Only an
  // operator decides this, so it stays on the Access-gated host and the
  // decision carries their email (decision 28).
  app.get("/discord/authorizations", (c) =>
    c.json({
      authorizations: deps.notifications.listGuildRepos().map((a) => ({
        guild_id: a.guildId,
        guild_name: a.guildName,
        repo: a.repo,
        authorized_by: a.authorizedBy,
        authorized_at: a.authorizedAt,
      })),
    }),
  );

  app.put("/discord/authorizations/:guildId/:owner/:name", async (c) => {
    const discord = deps.discord;
    if (!discord) return c.json({ ok: false, error: "discord is not configured" }, 503);
    const guildId = c.req.param("guildId");
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    if (!SNOWFLAKE.test(guildId)) return c.json({ ok: false, error: "bad guild id" }, 400);
    if (!REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
      return c.json({ ok: false, error: "bad repo name" }, 400);
    }
    // The bot must already be in the server, or the commands can never appear
    // there and the authorization would be a promise nothing can keep.
    const guilds = await discord.listGuilds().catch(() => null);
    if (!guilds) return c.json({ ok: false, error: "could not read the bot's servers" }, 400);
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild) return c.json({ ok: false, error: "the bot is not in that server" }, 400);

    // A repo the App is not installed on can never produce a review, so
    // authorizing one is a typo, not a decision.
    const repo = `${owner}/${name}`.toLowerCase();
    const installed = await deps.github?.installedRepos().catch(() => null);
    if (installed && !installed.some((full) => full.toLowerCase() === repo)) {
      return c.json({ ok: false, error: "the Cujo App is not installed on that repo" }, 400);
    }

    const stored = deps.notifications.authorizeGuildRepo({
      guildId,
      repo: `${owner}/${name}`,
      guildName: guild.name,
      authorizedBy: c.get("email"),
    });
    return c.json({
      guild_id: stored.guildId,
      guild_name: stored.guildName,
      repo: stored.repo,
      authorized_by: stored.authorizedBy,
      authorized_at: stored.authorizedAt,
    });
  });

  app.delete("/discord/authorizations/:guildId/:owner/:name", (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!deps.notifications.revokeGuildRepo(c.req.param("guildId"), repo)) {
      return c.json({ ok: false, error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/discord/guilds", async (c) => {
    const discord = deps.discord;
    if (!discord) return c.json({ ok: false, error: "discord is not configured" }, 503);
    const guilds = await discord.listGuilds();
    return c.json({ guilds: guilds.map((g) => ({ id: g.id, name: g.name })) });
  });

  app.get("/discord/guilds/:id/channels", async (c) => {
    const discord = deps.discord;
    if (!discord) return c.json({ ok: false, error: "discord is not configured" }, 503);
    const guildId = c.req.param("id");
    if (!SNOWFLAKE.test(guildId)) return c.json({ ok: false, error: "bad guild id" }, 400);
    const channels = await discord.listChannels(guildId);
    return c.json({
      channels: channels
        .filter((ch) => ch.type === GUILD_TEXT || ch.type === GUILD_ANNOUNCEMENT)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          parent_id: ch.parent_id ?? null,
        })),
    });
  });

  return app;
}
