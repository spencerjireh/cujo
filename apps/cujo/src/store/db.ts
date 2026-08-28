/**
 * The connection, the schema, and the migration ladder. Backed by node:sqlite
 * so the runtime image needs no native module.
 *
 * Every table is created here rather than beside the store that reads it: the
 * schema is one statement that either applies whole or does not, and splitting
 * it across two files would make the order of two `CREATE TABLE IF NOT EXISTS`
 * blocks matter for no reason.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded through the runtime rather than an import so vitest's module
// transformer, which does not know node:sqlite, leaves it alone.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

export type Db = DatabaseSyncType;

/**
 * Ordered, append-only. Index `i` takes the database from `user_version` `i`
 * to `i + 1`, and each runs inside the transaction that bumps the version, so
 * a container killed mid-migration comes back either before or after it, never
 * halfway.
 *
 * Decision 25 chose new tables over new columns because there was no mechanism
 * here; decision 30 adds it at the first change that genuinely needed one.
 * Adding a table is still simpler and still preferred — this is for altering
 * one that already exists in a deployed database.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — who bound a repo to a channel. An operator's Access email, or
  //     `discord:<user id>` when it came from a slash command (Contract 8).
  "ALTER TABLE discord_channels ADD COLUMN bound_by TEXT",
  // 2 — was the repo public when the run was claimed (decision 34). Nullable
  //     with no default on purpose: NULL means nobody ever answered, which is
  //     not the same fact as "answered: private", and only the nullable form
  //     lets the visibility sweep say how many rows it still has to backfill.
  //     Every public read filters `is_public = 1`, so an unanswered row is
  //     excluded by the query rather than by a caller remembering to check.
  "ALTER TABLE runs ADD COLUMN is_public INTEGER",
  // 3 — the `X-GitHub-Delivery` of the webhook that claimed the run
  //     (decision 37). The request answers 202 and returns while the run
  //     outlives it, and a rehydrate, a poll tick and an approve have no
  //     request at all, so the correlation id has to be on the row rather
  //     than in a variable. Nullable with no default: a run claimed before
  //     this column existed genuinely has no delivery, which is not the same
  //     fact as an empty one.
  "ALTER TABLE runs ADD COLUMN delivery_id TEXT",
];

const SCHEMA = `
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
  -- Fresh databases get the tables below at their original shape and then
  -- run the same migrations a deployed one does, so both converge.
  -- Contract 7. New tables rather than columns on runs: this schema has no
  -- ALTER TABLE path, so a column would apply to a fresh database and
  -- silently not to the deployed one (decision 25).
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
  -- Contract 8. Which Discord server may manage which repo's
  -- notifications. Written only over the Access-gated API, so the reach of
  -- a server is always a decision an operator's email is attached to
  -- (decision 28).
  CREATE TABLE IF NOT EXISTS discord_guild_repos (
    guild_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    guild_name TEXT,
    authorized_by TEXT NOT NULL,
    authorized_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, repo)
  );
  -- The PR title for the card. RunRecord has no title and the webhook is
  -- the only place it is ever read.
  CREATE TABLE IF NOT EXISTS run_pr_meta (
    run_id TEXT PRIMARY KEY REFERENCES runs (id),
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Apply every migration the database has not seen, each inside the
 * transaction that records it. `PRAGMA user_version` is SQLite's own
 * four-byte slot for exactly this, so it needs no table of its own.
 */
function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
    const statement = MIGRATIONS[version];
    if (!statement) continue;
    db.exec("BEGIN");
    try {
      db.exec(statement);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${version + 1} failed: ${String(error)}`);
    }
  }
}

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * GitHub repo names are case-insensitive and `repository.full_name` carries
 * whatever casing the owner typed, so a mapping typed by hand would otherwise
 * silently never match. Normalised on both write and lookup.
 */
export function normalizeRepo(repo: string): string {
  return repo.toLowerCase();
}
