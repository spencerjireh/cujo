import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  GUILD_ANNOUNCEMENT,
  GUILD_TEXT,
  REQUIRED_PERMISSIONS,
  effectivePermissions,
  hasPermissions,
} from "../../clients/discord";
import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import type { DiscordChannelRecord } from "../../notify/types";
import type { RunView, Runner } from "../../review/runner.service";
import type { Store } from "../../store";
import type { AccessVerifier } from "./access";

export interface ApiDeps {
  store: Store;
  runner: Runner;
  verify: AccessVerifier;
  /** Absent when DISCORD_BOT_TOKEN is unset; the Discord routes then 503. */
  discord?: DiscordClient;
  /** Used to check a repo is one the Cujo App can actually review. */
  github?: GitHubReader;
}

type Env = { Variables: { email: string } };

function serialize(view: RunView) {
  const { run, projection } = view;
  return {
    id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    session_id: run.sessionId,
    turn_ids: run.turnIds,
    status: run.status,
    approver: run.approver,
    decided_at: run.decidedAt,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    checks: projection.checks,
    findings: projection.findings,
    hard_rule_hits: projection.hardRuleHits,
    review: projection.review,
    approval: run.status === "blocked_pending" ? projection.approval : null,
    external_resume: projection.externalResume,
    error: projection.error,
    summary: projection.summary,
  };
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

/** Contract 6 operator API. Every route requires a verified Access assertion. */
export function apiRoutes(deps: ApiDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const email = await deps.verify(c.req.header("cf-access-jwt-assertion"));
    if (!email) return c.json({ ok: false, error: "unauthorized" }, 401);
    c.set("email", email);
    await next();
  });

  app.get("/runs", (c) => {
    const runs = deps.store.runs.listRuns().map((run) => ({
      id: run.id,
      repo: run.repo,
      pr_number: run.prNumber,
      head_sha: run.headSha,
      status: run.status,
      approver: run.approver,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    }));
    return c.json({ runs });
  });

  app.get("/runs/:id", (c) => {
    const view = deps.runner.view(c.req.param("id"));
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return c.json(serialize(view));
  });

  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const view = deps.runner.view(id);
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return streamSSE(c, async (stream) => {
      let seq = 0;
      const send = (v: RunView) =>
        stream.writeSSE({ event: "run", id: String(seq++), data: JSON.stringify(serialize(v)) });
      // Listen first, then read: an update between the two is delivered
      // twice at worst, never lost.
      const listener = (v: RunView) => void send(v);
      deps.runner.changes.on(id, listener);
      await send(deps.runner.view(id) ?? view);
      const keepalive = setInterval(
        () => void stream.writeSSE({ event: "ping", data: "" }),
        25_000,
      );
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
      clearInterval(keepalive);
      deps.runner.changes.off(id, listener);
    });
  });

  app.post("/runs/:id/approve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== "allow" && body.decision !== "deny") {
      return c.json({ ok: false, error: "decision must be allow or deny" }, 400);
    }
    const result = await deps.runner.approve(c.req.param("id"), body.decision, c.get("email"));
    if (!result.ok) return c.json({ ok: false, error: result.reason }, 409);
    return c.json({ ok: true, decision: body.decision, approver: c.get("email") });
  });

  // Contract 7. The repo-to-channel bindings. The bot token is never returned
  // here, masked or otherwise; `configured` is all the UI needs to know.
  app.get("/discord/channels", (c) =>
    c.json({
      configured: Boolean(deps.discord),
      channels: deps.store.notifications.listDiscordChannels().map(serializeChannel),
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
    // the first blocked run. 403 and 404 give the same answer on purpose: the
    // difference would let an operator probe channels across all of Discord.
    let channel: Awaited<ReturnType<DiscordClient["getChannel"]>>;
    try {
      channel = await discord.getChannel(channelId);
    } catch (error) {
      console.error(`discord: could not read channel ${channelId}`, error);
      return c.json({ ok: false, error: "the bot cannot see that channel" }, 400);
    }
    if (channel.type !== GUILD_TEXT && channel.type !== GUILD_ANNOUNCEMENT) {
      return c.json({ ok: false, error: "not a guild text channel" }, 400);
    }
    const guildId = channel.guild_id;
    if (!guildId) return c.json({ ok: false, error: "not a guild text channel" }, 400);

    const roles = await discord.listRoles(guildId).catch(() => null);
    if (!roles) return c.json({ ok: false, error: "could not read the server's roles" }, 400);
    if (notifyRoleId && !roles.some((r) => r.id === notifyRoleId)) {
      // Otherwise the ping would mention nobody and say nothing about it.
      return c.json({ ok: false, error: "no such role in that server" }, 400);
    }

    // Reading a channel does not mean the bot may post an embed in it. A
    // channel-level deny would otherwise bind cleanly and then fail on every
    // run, which is the silent failure this whole route exists to prevent.
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
      console.error(`discord: could not resolve permissions in ${channelId}`, error);
      return null;
    });
    if (permissions === null) {
      return c.json({ ok: false, error: "could not check the bot's permissions" }, 400);
    }
    if (!hasPermissions(permissions, REQUIRED_PERMISSIONS)) {
      return c.json(
        { ok: false, error: "the bot needs View Channel, Send Messages and Embed Links there" },
        400,
      );
    }
    const stored = deps.store.notifications.putDiscordChannel({
      repo: `${owner}/${name}`,
      channelId,
      guildId,
      channelName: channel.name ?? null,
      notifyRoleId,
      boundBy: c.get("email"),
    });
    return c.json(serializeChannel(stored));
  });

  app.delete("/discord/channels/:owner/:name", (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!deps.store.notifications.deleteDiscordChannel(repo)) {
      return c.json({ ok: false, error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });

  // Contract 8, tier one. Which Discord server may manage which repo. Only an
  // operator decides this, so it stays on the Access-gated host and the
  // decision carries their email (decision 28).
  app.get("/discord/authorizations", (c) =>
    c.json({
      authorizations: deps.store.notifications.listGuildRepos().map((a) => ({
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

    const stored = deps.store.notifications.authorizeGuildRepo({
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
    if (!deps.store.notifications.revokeGuildRepo(c.req.param("guildId"), repo)) {
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
