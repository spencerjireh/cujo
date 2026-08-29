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
import { MIGRATIONS, SCHEMA } from "../../src/store/db";

// Through the runtime, not an import: vitest's transformer does not know
// node:sqlite, which is why `src/store/db.ts` reaches for it the same way.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

describe("the migration ladder", () => {
  it("keeps every shipped entry byte for byte", () => {
    // Append below this list; never edit a line in it.
    expect(MIGRATIONS[0]).toBe("ALTER TABLE discord_channels ADD COLUMN bound_by TEXT");
    expect(MIGRATIONS[1]).toBe("ALTER TABLE runs ADD COLUMN is_public INTEGER");
    expect(MIGRATIONS[2]).toBe("ALTER TABLE runs ADD COLUMN delivery_id TEXT");
    expect(MIGRATIONS[3]).toBe("DROP TABLE IF EXISTS discord_guild_repos");
  });

  it("has no gaps, since index i takes user_version i to i + 1", () => {
    expect(MIGRATIONS.every((statement) => typeof statement === "string" && statement.length > 0));
    expect(MIGRATIONS).toHaveLength(4);
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
   * The first entry that removes something. `SCHEMA` is all `IF NOT EXISTS`,
   * so deleting the `CREATE` there does nothing to a database that already ran
   * it — the deployed volume would keep the table forever, and the next person
   * to find rows in it would conclude the operator override still works.
   *
   * `IF EXISTS` because a fresh database never created it, and index 3 has to
   * be a no-op there rather than an error that rolls back the version bump.
   */
  it("drops the guild-authorization table, and tolerates a database that never had it", () => {
    expect(MIGRATIONS[3]).toMatch(/^DROP TABLE IF EXISTS /);
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
  /** A file at `user_version` 3, holding the table the override wrote to. */
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

  it("drops the override table and lands on the current version", () => {
    const { dir, path } = atVersion3();
    try {
      expect(tables(path)).toContain("discord_guild_repos");
      new Store(path).close();
      expect(tables(path)).not.toContain("discord_guild_repos");
      expect(userVersion(path)).toBe(MIGRATIONS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op on a database that never had the table", () => {
    // `IF EXISTS` is what makes index 3 safe on a fresh file. Without it the
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
});
