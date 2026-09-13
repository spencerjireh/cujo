/**
 * A guard on the migration ladder itself, not on any one migration.
 *
 * `MIGRATIONS` is indexed by `user_version`, so editing a past entry silently
 * skips it on every database that already ran it while applying the new text to
 * fresh ones — the two then diverge forever. CONTRIBUTING states the rule;
 * this makes CI check it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";
import { MIGRATIONS, SCHEMA, TERMINAL_STATUSES_SQL } from "../../src/store/db";

// Through the runtime, not an import: vitest's transformer does not know
// node:sqlite, which is why `src/store/db.ts` reaches for it the same way.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

describe("the migration ladder", () => {
  it("keeps every shipped entry byte for byte", () => {
    // Append below this list; never edit a line in it.
    expect(MIGRATIONS[0]).toBe("ALTER TABLE discord_channels ADD COLUMN bound_by TEXT");
    expect(MIGRATIONS[1]).toBe("ALTER TABLE runs ADD COLUMN is_public INTEGER");
    expect(MIGRATIONS[2]).toBe("ALTER TABLE runs ADD COLUMN delivery_id TEXT");
    expect(MIGRATIONS[3]).toBe("ALTER TABLE run_pr_meta ADD COLUMN author_login TEXT");
    expect(MIGRATIONS[4]).toBe("ALTER TABLE run_pr_meta ADD COLUMN author_id INTEGER");
    expect(MIGRATIONS[5]).toBe("DROP TABLE IF EXISTS discord_guild_repos");
    expect(MIGRATIONS[6]).toBe("ALTER TABLE runs ADD COLUMN model TEXT");
    expect(MIGRATIONS[7]).toBe("ALTER TABLE runs ADD COLUMN rubric_sha256 TEXT");
    expect(MIGRATIONS[8]).toContain("DROP INDEX IF EXISTS runs_head");
    expect(MIGRATIONS[8]).toContain("CREATE UNIQUE INDEX runs_head");
    expect(MIGRATIONS[8]).toContain("WHERE status NOT IN");
    // 9 keeps its own literal list rather than the shared constant, because
    // that is the text a deployed database already ran.
    expect(MIGRATIONS[8]).not.toContain("unproven");
    expect(MIGRATIONS[9]).toContain("DROP INDEX IF EXISTS runs_head");
    expect(MIGRATIONS[9]).toContain("CREATE UNIQUE INDEX runs_head");
    // 10 once interpolated the shared constant. It is frozen to the list it
    // ran with, so the constant can move on (13 did) without rewriting it.
    expect(MIGRATIONS[9]).toContain(
      "('superseded', 'error', 'clean', 'unproven', 'blocked_unattended', 'blocked_posted', 'denied')",
    );
    expect(MIGRATIONS[10]).toBe("ALTER TABLE runs ADD COLUMN mode TEXT");
    expect(MIGRATIONS[11]).toBe("ALTER TABLE runs ADD COLUMN budget_tokens INTEGER");
    expect(MIGRATIONS[12]).toContain("DROP INDEX IF EXISTS runs_head");
    expect(MIGRATIONS[12]).toContain(
      "UPDATE runs SET status = 'blocked' WHERE status IN ('blocked_unattended', 'blocked_posted')",
    );
    expect(MIGRATIONS[12]).toContain(
      "UPDATE runs SET status = 'dismissed' WHERE status = 'denied'",
    );
    expect(MIGRATIONS[12]).toContain(
      "UPDATE runs SET status = 'error' WHERE status = 'blocked_pending'",
    );
    expect(MIGRATIONS[12]).toContain("DROP TABLE IF EXISTS run_cujo_turns");
  });

  it("has no gaps, since index i takes user_version i to i + 1", () => {
    expect(MIGRATIONS.every((statement) => typeof statement === "string" && statement.length > 0));
    expect(MIGRATIONS).toHaveLength(13);
  });

  /**
   * Same again. A NULL mode is a run from before there were two reviews, and
   * `toRecord` reads it as `sandbox`; a NULL budget is a turn that had none.
   * A default would stamp both on rows that were never given either.
   */
  it("adds mode and budget_tokens without a default", () => {
    for (const i of [10, 11]) {
      expect(MIGRATIONS[i]).not.toMatch(/DEFAULT/i);
      expect(MIGRATIONS[i]).not.toMatch(/NOT NULL/i);
    }
  });

  /**
   * The column is deliberately nullable with no default. `NOT NULL DEFAULT 0`
   * would answer "private" for every row that predates it, which reads the same
   * but cannot be told apart from a row the sweep has yet to reach.
   */
  it("adds is_public without a default, so an unanswered row stays unanswered", () => {
    expect(MIGRATIONS[1]).not.toMatch(/DEFAULT/i);
    expect(MIGRATIONS[1]).not.toMatch(/NOT NULL/i);
  });

  /**
   * Same reasoning, different fact. A run claimed before the column existed
   * genuinely has no delivery, and `NOT NULL DEFAULT ''` would give it a value
   * that reads as one — an empty correlation id every old run shares.
   */
  it("adds delivery_id without a default, so a run that had none says so", () => {
    expect(MIGRATIONS[2]).not.toMatch(/DEFAULT/i);
    expect(MIGRATIONS[2]).not.toMatch(/NOT NULL/i);
  });

  /**
   * Same reasoning again, and one more case beside it. A run recorded before
   * these columns has no author, and neither does a pull request whose account
   * was deleted — an empty login would read as a person nobody can look up.
   */
  it("adds the author columns without a default, so a run that had none says so", () => {
    for (const statement of [MIGRATIONS[3], MIGRATIONS[4]]) {
      expect(statement).not.toMatch(/DEFAULT/i);
      expect(statement).not.toMatch(/NOT NULL/i);
    }
  });

  /**
   * Same reasoning once more. A run claimed before these columns was produced
   * by a model and a rubric nobody recorded; an empty string would read as a
   * model with no name, which is a different and false claim.
   */
  it("adds the provenance columns without a default, so an unrecorded run says so", () => {
    for (const statement of [MIGRATIONS[6], MIGRATIONS[7]]) {
      expect(statement).not.toMatch(/DEFAULT/i);
      expect(statement).not.toMatch(/NOT NULL/i);
    }
  });

  /**
   * The first entry that removes something. `SCHEMA` is all `IF NOT EXISTS`,
   * so deleting the `CREATE` there does nothing to a database that already ran
   * it — the deployed volume would keep the table forever, and the next person
   * to find rows in it would conclude the operator override still works.
   *
   * `IF EXISTS` because a fresh database never created it, and the entry has
   * to be a no-op there rather than an error that rolls back the version
   * bump. Last in the ladder, because `migrate()` walks `user_version`
   * forward: a database that already ran the author columns would never see
   * an entry inserted before them.
   */
  it("drops the guild-authorization table, and tolerates a database that never had it", () => {
    expect(MIGRATIONS[5]).toMatch(/^DROP TABLE IF EXISTS /);
  });

  /**
   * `unproven` is terminal (decision 107), and the partial index is the place
   * that has to know. A status missing from the list is silent — nothing fails
   * to compile and nothing throws; the next run on the same head is simply
   * refused as a duplicate of one that is actually finished.
   */
  it("rebuilds the head index over the current terminal list, spelled out", () => {
    // The newest index rebuild carries the same list as the constant, as a
    // literal: the next terminal status is migration 14, never an edit here.
    expect(TERMINAL_STATUSES_SQL).toContain("'unproven'");
    expect(TERMINAL_STATUSES_SQL).toContain("'blocked'");
    expect(TERMINAL_STATUSES_SQL).toContain("'dismissed'");
    expect(TERMINAL_STATUSES_SQL).not.toContain("blocked_");
    expect(MIGRATIONS[12]).toContain(`WHERE status NOT IN ${TERMINAL_STATUSES_SQL}`);
    // And the fresh-database schema says the same thing, or the two diverge.
    expect(SCHEMA).toContain(TERMINAL_STATUSES_SQL);
  });

  it("has an empty schema statement for the table it dropped", () => {
    // The pair is the point: removing only the CREATE leaves a deployed
    // database untouched, and adding only the DROP means every fresh boot
    // creates the table and then drops it.
    expect(SCHEMA).not.toContain("discord_guild_repos");
  });
});

/**
 * The ladder run against a real file, because the assertions above are about
 * strings and the thing that actually matters is what happens to the deployed
 * volume. `:memory:` cannot show this: the interesting database is one that
 * already ran an earlier version.
 */
describe("migrating a database that predates this release", () => {
  /**
   * A file at `user_version` 3: the table the override wrote to, and
   * `run_pr_meta` at the shape it had before the author columns. Both, because
   * opening it now runs three migrations and two of them alter that table — a
   * fixture holding only the override table would fail on a missing table
   * rather than on anything this test is about.
   */
  function atVersion3(): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "cujo-migrate-"));
    const path = join(dir, "cujo.db");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE discord_guild_repos (
        guild_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        guild_name TEXT,
        authorized_by TEXT NOT NULL,
        authorized_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, repo)
      );
      CREATE TABLE run_pr_meta (
        run_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO discord_guild_repos VALUES (?, ?, ?, ?, ?)").run(
      "g1",
      "o/r",
      "My Server",
      "operator",
      "2026-08-01T00:00:00.000Z",
    );
    db.exec("PRAGMA user_version = 3");
    db.close();
    return { dir, path };
  }

  const tables = (path: string): string[] => {
    const db = new DatabaseSync(path);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    db.close();
    return rows.map((row) => row.name);
  };

  const userVersion = (path: string): number => {
    const db = new DatabaseSync(path);
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    db.close();
    return row.user_version;
  };

  const columns = (path: string, table: string): string[] => {
    const db = new DatabaseSync(path);
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    db.close();
    return rows.map((row) => row.name);
  };

  it("drops the override table, adds the author columns, and lands on the current version", () => {
    const { dir, path } = atVersion3();
    try {
      expect(tables(path)).toContain("discord_guild_repos");
      new Store(path).close();
      expect(tables(path)).not.toContain("discord_guild_repos");
      // The two entries ahead of the DROP ran too, which is the whole reason
      // its index had to move rather than be inserted.
      expect(columns(path, "run_pr_meta")).toEqual(
        expect.arrayContaining(["author_login", "author_id"]),
      );
      expect(userVersion(path)).toBe(MIGRATIONS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op on a database that never had the table", () => {
    // `IF EXISTS` is what makes the entry safe on a fresh file. Without it the
    // statement throws, the transaction rolls back, and the version never
    // advances — so every boot would retry it forever.
    const dir = mkdtempSync(join(tmpdir(), "cujo-fresh-"));
    const path = join(dir, "cujo.db");
    try {
      new Store(path).close();
      expect(tables(path)).not.toContain("discord_guild_repos");
      expect(userVersion(path)).toBe(MIGRATIONS.length);
      // And running it twice changes nothing, which is what a restart does.
      new Store(path).close();
      expect(userVersion(path)).toBe(MIGRATIONS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  /**
   * The gate's three statuses on a database that ran everything up to 12
   * (decision 139). Seeded by hand at that version: the map is the fact under
   * test, and so is the index being dropped before the UPDATEs — two
   * `blocked_unattended` rows on one head were legal and both become
   * `blocked`, which the old index would have refused as two active runs.
   */
  it("migrates the gate's statuses and frees their heads", () => {
    const dir = mkdtempSync(join(tmpdir(), "cujo-gate-"));
    const path = join(dir, "cujo.db");
    try {
      const db = new DatabaseSync(path);
      db.exec(SCHEMA.replace(TERMINAL_STATUSES_SQL, "('superseded', 'error', 'clean')"));
      const at = "2026-09-01T00:00:00.000Z";
      const insert = db.prepare(
        "INSERT INTO runs (id, repo, pr_number, head_sha, session_id, status, created_at, updated_at) VALUES (?, 'o/r', 1, ?, 's', ?, ?, ?)",
      );
      insert.run("a", "h1", "blocked_unattended", at, at);
      insert.run("b", "h2", "blocked_posted", at, at);
      insert.run("c", "h3", "denied", at, at);
      insert.run("d", "h4", "blocked_pending", at, at);
      insert.run("e", "h5", "clean", at, at);
      db.prepare(
        "INSERT INTO run_discord_messages (run_id, channel_id, message_id, last_notified_status, updated_at) VALUES ('d', 'c', 'm', 'blocked_pending', ?)",
      ).run(at);
      db.exec("PRAGMA user_version = 12");
      db.close();

      new Store(path).close();

      const after = new DatabaseSync(path);
      const status = (id: string) =>
        (after.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string })
          .status;
      expect([status("a"), status("b"), status("c"), status("d"), status("e")]).toEqual([
        "blocked",
        "blocked",
        "dismissed",
        "error",
        "clean",
      ]);
      expect(
        (
          after
            .prepare(
              "SELECT last_notified_status AS s FROM run_discord_messages WHERE run_id = 'd'",
            )
            .get() as { s: string }
        ).s,
      ).toBe("error");
      // Every migrated row is terminal, so each head is free for a new run.
      after
        .prepare(
          "INSERT INTO runs (id, repo, pr_number, head_sha, session_id, status, created_at, updated_at) VALUES ('f', 'o/r', 1, 'h1', 's', 'running', ?, ?)",
        )
        .run(at, at);
      expect(userVersion(path)).toBe(MIGRATIONS.length);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
