/**
 * A guard on the migration ladder itself, not on any one migration.
 *
 * `MIGRATIONS` is indexed by `user_version`, so editing a past entry silently
 * skips it on every database that already ran it while applying the new text to
 * fresh ones — the two then diverge forever. CONTRIBUTING states the rule;
 * this makes CI check it.
 */

import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/store/db";

describe("the migration ladder", () => {
  it("keeps every shipped entry byte for byte", () => {
    // Append below this list; never edit a line in it.
    expect(MIGRATIONS[0]).toBe("ALTER TABLE discord_channels ADD COLUMN bound_by TEXT");
    expect(MIGRATIONS[1]).toBe("ALTER TABLE runs ADD COLUMN is_public INTEGER");
    expect(MIGRATIONS[2]).toBe("ALTER TABLE runs ADD COLUMN delivery_id TEXT");
  });

  it("has no gaps, since index i takes user_version i to i + 1", () => {
    expect(MIGRATIONS.every((statement) => typeof statement === "string" && statement.length > 0));
    expect(MIGRATIONS).toHaveLength(3);
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
});
