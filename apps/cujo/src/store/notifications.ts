/**
 * What Cujo remembers about notifying Discord: which repo goes to which
 * channel, which server an operator allowed, and which message was already
 * posted for a run (spec Contracts 7 and 8).
 *
 * Deliberately holds no run state and no way to reach any. The `/cujo`
 * commands are handed one of these and nothing else, which is what makes
 * "Discord routes notifications and never approves a review" (decision 28) a
 * fact about the types rather than a rule someone has to remember.
 */

import type {
  DiscordChannelRecord,
  GuildRepoAuthorization,
  RunDiscordMessage,
} from "../notify/types";
import type { RunStatus } from "../review/types";
import { type Db, normalizeRepo } from "./db";

interface DiscordChannelRow {
  repo: string;
  channel_id: string;
  guild_id: string | null;
  channel_name: string | null;
  notify_role_id: string | null;
  bound_by: string | null;
  created_at: string;
  updated_at: string;
}

function toDiscordChannel(row: DiscordChannelRow): DiscordChannelRecord {
  return {
    repo: row.repo,
    channelId: row.channel_id,
    guildId: row.guild_id,
    channelName: row.channel_name,
    notifyRoleId: row.notify_role_id,
    boundBy: row.bound_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NotificationStore {
  constructor(private readonly db: Db) {}

  getDiscordChannel(repo: string): DiscordChannelRecord | null {
    const row = this.db
      .prepare("SELECT * FROM discord_channels WHERE repo = ?")
      .get(normalizeRepo(repo)) as DiscordChannelRow | undefined;
    return row ? toDiscordChannel(row) : null;
  }

  listDiscordChannels(): DiscordChannelRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM discord_channels ORDER BY repo")
      .all() as DiscordChannelRow[];
    return rows.map(toDiscordChannel);
  }

  /** Upsert the binding for a repo. `created_at` survives a re-bind. */
  putDiscordChannel(input: {
    repo: string;
    channelId: string;
    guildId: string | null;
    channelName: string | null;
    notifyRoleId: string | null;
    /** An Access email, or `discord:<user id>` from a slash command. */
    boundBy?: string | null;
  }): DiscordChannelRecord {
    const now = new Date().toISOString();
    const repo = normalizeRepo(input.repo);
    this.db
      .prepare(
        "INSERT INTO discord_channels (repo, channel_id, guild_id, channel_name, " +
          "notify_role_id, bound_by, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (repo) DO UPDATE SET channel_id = excluded.channel_id, " +
          "guild_id = excluded.guild_id, channel_name = excluded.channel_name, " +
          "notify_role_id = excluded.notify_role_id, bound_by = excluded.bound_by, " +
          "updated_at = excluded.updated_at",
      )
      .run(
        repo,
        input.channelId,
        input.guildId,
        input.channelName,
        input.notifyRoleId,
        input.boundBy ?? null,
        now,
        now,
      );
    const stored = this.getDiscordChannel(repo);
    if (!stored) throw new Error("discord channel vanished after insert");
    return stored;
  }

  /** False when no binding existed for that repo. */
  deleteDiscordChannel(repo: string): boolean {
    const result = this.db
      .prepare("DELETE FROM discord_channels WHERE repo = ?")
      .run(normalizeRepo(repo));
    return Number(result.changes) === 1;
  }

  /** True when this server has been authorized for this repo (Contract 8). */
  isGuildAuthorized(guildId: string, repo: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM discord_guild_repos WHERE guild_id = ? AND repo = ?")
      .get(guildId, normalizeRepo(repo)) as { ok: number } | undefined;
    return row !== undefined;
  }

  /** Every authorization, or just one server's when `guildId` is given. */
  listGuildRepos(guildId?: string): GuildRepoAuthorization[] {
    const rows = (
      guildId
        ? this.db
            .prepare("SELECT * FROM discord_guild_repos WHERE guild_id = ? ORDER BY repo")
            .all(guildId)
        : this.db.prepare("SELECT * FROM discord_guild_repos ORDER BY guild_id, repo").all()
    ) as {
      guild_id: string;
      repo: string;
      guild_name: string | null;
      authorized_by: string;
      authorized_at: string;
    }[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      repo: row.repo,
      guildName: row.guild_name,
      authorizedBy: row.authorized_by,
      authorizedAt: row.authorized_at,
    }));
  }

  authorizeGuildRepo(input: {
    guildId: string;
    repo: string;
    guildName: string | null;
    authorizedBy: string;
  }): GuildRepoAuthorization {
    const now = new Date().toISOString();
    const repo = normalizeRepo(input.repo);
    this.db
      .prepare(
        "INSERT INTO discord_guild_repos " +
          "(guild_id, repo, guild_name, authorized_by, authorized_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (guild_id, repo) DO UPDATE SET guild_name = excluded.guild_name, " +
          "authorized_by = excluded.authorized_by, authorized_at = excluded.authorized_at",
      )
      .run(input.guildId, repo, input.guildName, input.authorizedBy, now);
    return {
      guildId: input.guildId,
      repo,
      guildName: input.guildName,
      authorizedBy: input.authorizedBy,
      authorizedAt: now,
    };
  }

  /**
   * Revoke, and drop the binding it permitted: leaving the channel bound would
   * keep a server receiving reviews it is no longer authorized for.
   */
  revokeGuildRepo(guildId: string, repo: string): boolean {
    const normalized = normalizeRepo(repo);
    const result = this.db
      .prepare("DELETE FROM discord_guild_repos WHERE guild_id = ? AND repo = ?")
      .run(guildId, normalized);
    if (Number(result.changes) !== 1) return false;
    const binding = this.getDiscordChannel(normalized);
    if (binding && binding.guildId === guildId) this.deleteDiscordChannel(normalized);
    return true;
  }

  getRunDiscordMessage(runId: string): RunDiscordMessage | null {
    const row = this.db.prepare("SELECT * FROM run_discord_messages WHERE run_id = ?").get(runId) as
      | {
          run_id: string;
          channel_id: string;
          message_id: string | null;
          ping_message_id: string | null;
          ping_resolved: number;
          last_notified_status: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      runId: row.run_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      pingMessageId: row.ping_message_id,
      pingResolved: row.ping_resolved === 1,
      lastNotifiedStatus: (row.last_notified_status as RunStatus | null) ?? null,
    };
  }

  /**
   * Write the whole row. The notifier sends on one serial queue, so there is
   * never a concurrent writer for a run.
   */
  putRunDiscordMessage(row: RunDiscordMessage): void {
    this.db
      .prepare(
        "INSERT INTO run_discord_messages (run_id, channel_id, message_id, ping_message_id, " +
          "ping_resolved, last_notified_status, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET channel_id = excluded.channel_id, " +
          "message_id = excluded.message_id, ping_message_id = excluded.ping_message_id, " +
          "ping_resolved = excluded.ping_resolved, " +
          "last_notified_status = excluded.last_notified_status, updated_at = excluded.updated_at",
      )
      .run(
        row.runId,
        row.channelId,
        row.messageId,
        row.pingMessageId,
        row.pingResolved ? 1 : 0,
        row.lastNotifiedStatus,
        new Date().toISOString(),
      );
  }

  /**
   * Forget the card posted for a run. Called by RunStore when a run row goes
   * away, since the message row is keyed by a run id that is about to stop
   * existing — and, on the stale-reclaim path, must go before the unique index
   * on (repo, pr_number, head_sha) will let the replacement row be inserted.
   */
  deleteRunMessages(runId: string): void {
    this.db.prepare("DELETE FROM run_discord_messages WHERE run_id = ?").run(runId);
  }
}
