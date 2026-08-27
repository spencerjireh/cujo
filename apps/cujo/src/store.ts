import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  DiscordChannelRecord,
  Projection,
  RunDiscordMessage,
  RunRecord,
  RunStatus,
} from "./types";

// Loaded through the runtime rather than an import so vitest's module
// transformer, which does not know node:sqlite, leaves it alone.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
type DatabaseSync = DatabaseSyncType;

interface RunRow {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  session_id: string;
  turn_ids: string;
  status: string;
  approver: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DiscordChannelRow {
  repo: string;
  channel_id: string;
  guild_id: string | null;
  channel_name: string | null;
  notify_role_id: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GitHub repo names are case-insensitive and `repository.full_name` carries
 * whatever casing the owner typed, so a mapping typed by hand would otherwise
 * silently never match. Normalised on both write and lookup.
 */
function normalizeRepo(repo: string): string {
  return repo.toLowerCase();
}

function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    repo: row.repo,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    sessionId: row.session_id,
    turnIds: JSON.parse(row.turn_ids) as string[],
    status: row.status as RunStatus,
    approver: row.approver,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The run store: the PR-to-session map, one row per run, and the folded
 * projection of each run. Backed by node:sqlite so the runtime image needs no
 * native module.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (repo, pr_number)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        approver TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at DESC);
      -- One run per PR head (Contract 5): a duplicate webhook delivery cannot
      -- claim a second run for the same SHA.
      CREATE UNIQUE INDEX IF NOT EXISTS runs_head ON runs (repo, pr_number, head_sha);
      CREATE TABLE IF NOT EXISTS run_projections (
        run_id TEXT PRIMARY KEY REFERENCES runs (id),
        projection TEXT NOT NULL
      );
      -- Resume turns Cujo itself sent, so a restart still tells them apart
      -- from a resume an operator sent through the harness console.
      CREATE TABLE IF NOT EXISTS run_cujo_turns (
        run_id TEXT NOT NULL REFERENCES runs (id),
        turn_id TEXT NOT NULL,
        PRIMARY KEY (run_id, turn_id)
      );
      -- Contract 7. New tables rather than columns on runs: this schema has no
      -- ALTER TABLE path, so a column would apply to a fresh database and
      -- silently not to the deployed one (decision 24).
      CREATE TABLE IF NOT EXISTS discord_channels (
        repo TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        guild_id TEXT,
        channel_name TEXT,
        notify_role_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_discord_messages (
        run_id TEXT PRIMARY KEY REFERENCES runs (id),
        channel_id TEXT NOT NULL,
        message_id TEXT,
        ping_message_id TEXT,
        ping_resolved INTEGER NOT NULL DEFAULT 0,
        last_notified_status TEXT,
        updated_at TEXT NOT NULL
      );
      -- A Discord message belongs to at most one run: the reverse lookup an
      -- interactions endpoint will need, enforced now while it is free.
      CREATE UNIQUE INDEX IF NOT EXISTS run_discord_message_id
        ON run_discord_messages (message_id) WHERE message_id IS NOT NULL;
      -- The PR title for the card. RunRecord has no title and the webhook is
      -- the only place it is ever read.
      CREATE TABLE IF NOT EXISTS run_pr_meta (
        run_id TEXT PRIMARY KEY REFERENCES runs (id),
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  getSession(repo: string, prNumber: number): string | null {
    const row = this.db
      .prepare("SELECT session_id FROM sessions WHERE repo = ? AND pr_number = ?")
      .get(repo, prNumber) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /**
   * First writer wins. Returns the session id now stored, which is the
   * caller's only when no other delivery got there first.
   */
  putSession(repo: string, prNumber: number, sessionId: string): string {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (repo, pr_number, session_id) VALUES (?, ?, ?)")
      .run(repo, prNumber, sessionId);
    const stored = this.getSession(repo, prNumber);
    if (!stored) throw new Error("session vanished after insert");
    return stored;
  }

  /**
   * Atomic claim of the run for a PR head. `created` is false when a run for
   * that head already exists, in which case the existing run is returned.
   *
   * A run that errored before it ever had a turn holds nothing worth keeping,
   * so its row is re-claimed: a redelivery then reviews the head instead of
   * being answered "duplicate delivery" forever.
   */
  createRun(input: {
    repo: string;
    prNumber: number;
    headSha: string;
    sessionId: string;
  }): { run: RunRecord; created: boolean } {
    const now = new Date().toISOString();
    const id = randomUUID();
    const stale = this.db
      .prepare(
        "SELECT id FROM runs WHERE repo = ? AND pr_number = ? AND head_sha = ? " +
          "AND status = 'error' AND turn_ids = '[]'",
      )
      .get(input.repo, input.prNumber, input.headSha) as { id: string } | undefined;
    if (stale) this.deleteRun(stale.id);
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO runs (id, repo, pr_number, head_sha, session_id, turn_ids, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, '[]', 'running', ?, ?)",
      )
      .run(id, input.repo, input.prNumber, input.headSha, input.sessionId, now, now);
    const row = this.db
      .prepare("SELECT * FROM runs WHERE repo = ? AND pr_number = ? AND head_sha = ?")
      .get(input.repo, input.prNumber, input.headSha) as RunRow | undefined;
    if (!row) throw new Error("run vanished after insert");
    return { run: toRecord(row), created: Number(result.changes) === 1 };
  }

  deleteRun(id: string): void {
    this.db.prepare("DELETE FROM run_projections WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM run_cujo_turns WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM run_discord_messages WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM run_pr_meta WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  addCujoTurn(runId: string, turnId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO run_cujo_turns (run_id, turn_id) VALUES (?, ?)")
      .run(runId, turnId);
  }

  listCujoTurns(runId: string): string[] {
    const rows = this.db
      .prepare("SELECT turn_id FROM run_cujo_turns WHERE run_id = ?")
      .all(runId) as { turn_id: string }[];
    return rows.map((r) => r.turn_id);
  }

  /** Every run that shares a session, so one run can skip the others' turns. */
  listRunsForSession(sessionId: string): RunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as RunRow[];
    return rows.map(toRecord);
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? toRecord(row) : null;
  }

  listRuns(limit = 100): RunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as RunRow[];
    return rows.map(toRecord);
  }

  listUnfinishedRuns(scope?: { repo: string; prNumber: number }): RunRecord[] {
    const where = "status IN ('running', 'blocked_pending')";
    const rows = (
      scope
        ? this.db
            .prepare(
              `SELECT * FROM runs WHERE ${where} AND repo = ? AND pr_number = ? ORDER BY created_at`,
            )
            .all(scope.repo, scope.prNumber)
        : this.db.prepare(`SELECT * FROM runs WHERE ${where} ORDER BY created_at`).all()
    ) as RunRow[];
    return rows.map(toRecord);
  }

  updateRun(
    id: string,
    patch: { status?: RunStatus; turnIds?: string[]; approver?: string; decidedAt?: string },
  ): RunRecord | null {
    const current = this.getRun(id);
    if (!current) return null;
    this.db
      .prepare(
        "UPDATE runs SET status = ?, turn_ids = ?, approver = ?, decided_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        patch.status ?? current.status,
        JSON.stringify(patch.turnIds ?? current.turnIds),
        patch.approver ?? current.approver,
        patch.decidedAt ?? current.decidedAt,
        new Date().toISOString(),
        id,
      );
    return this.getRun(id);
  }

  /**
   * Compare-and-set the decision: succeeds for exactly one caller while the
   * run is blocked_pending and undecided, so a second approve request cannot
   * resume the same call.
   */
  claimDecision(id: string, approver: string, decidedAt: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE runs SET approver = ?, decided_at = ?, updated_at = ? " +
          "WHERE id = ? AND status = 'blocked_pending' AND approver IS NULL",
      )
      .run(approver, decidedAt, new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  /** Undo a claim whose resume never reached the harness, so a retry is possible. */
  clearDecision(id: string): void {
    this.db
      .prepare("UPDATE runs SET approver = NULL, decided_at = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  putProjection(runId: string, projection: Projection): void {
    this.db
      .prepare(
        "INSERT INTO run_projections (run_id, projection) VALUES (?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET projection = excluded.projection",
      )
      .run(runId, JSON.stringify(projection));
  }

  getProjection(runId: string): Projection | null {
    const row = this.db
      .prepare("SELECT projection FROM run_projections WHERE run_id = ?")
      .get(runId) as { projection: string } | undefined;
    return row ? (JSON.parse(row.projection) as Projection) : null;
  }

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
  }): DiscordChannelRecord {
    const now = new Date().toISOString();
    const repo = normalizeRepo(input.repo);
    this.db
      .prepare(
        "INSERT INTO discord_channels " +
          "(repo, channel_id, guild_id, channel_name, notify_role_id, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (repo) DO UPDATE SET channel_id = excluded.channel_id, " +
          "guild_id = excluded.guild_id, channel_name = excluded.channel_name, " +
          "notify_role_id = excluded.notify_role_id, updated_at = excluded.updated_at",
      )
      .run(repo, input.channelId, input.guildId, input.channelName, input.notifyRoleId, now, now);
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

  putRunPrTitle(runId: string, title: string): void {
    this.db
      .prepare(
        "INSERT INTO run_pr_meta (run_id, title, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET title = excluded.title, " +
          "updated_at = excluded.updated_at",
      )
      .run(runId, title, new Date().toISOString());
  }

  getRunPrTitle(runId: string): string | null {
    const row = this.db.prepare("SELECT title FROM run_pr_meta WHERE run_id = ?").get(runId) as
      | { title: string }
      | undefined;
    return row?.title ?? null;
  }
}
