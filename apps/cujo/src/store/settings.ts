/**
 * Instance settings (decision 152): one row per key, the value as JSON, and
 * where it came from — `seed` for the environment's value written on the
 * first boot that knew the key, `owner` for a change made through Cujo. The
 * typed layer over this is `src/settings.ts`; this class knows nothing about
 * which keys exist or what they mean.
 *
 * Its own table rather than columns, because the set of keys grows with
 * every slice of track 10 and a new key must reach a deployed database on
 * open (decision 25).
 */

import type { Db } from "./db";

export type SettingSource = "seed" | "owner";

export interface SettingRow {
  key: string;
  /** JSON text, parsed by the typed layer. */
  value: string;
  source: SettingSource;
  updatedAt: string;
}

interface Row {
  key: string;
  value: string;
  source: string;
  updated_at: string;
}

export class SettingsStore {
  constructor(private readonly db: Db) {}

  get(key: string): SettingRow | null {
    const row = this.db.prepare("SELECT * FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? toRow(row) : null;
  }

  all(): SettingRow[] {
    const rows = this.db.prepare("SELECT * FROM settings ORDER BY key").all() as Row[];
    return rows.map(toRow);
  }

  put(key: string, value: string, source: SettingSource, at: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value, source, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, " +
          "updated_at = excluded.updated_at",
      )
      .run(key, value, source, at);
  }
}

function toRow(row: Row): SettingRow {
  return {
    key: row.key,
    value: row.value,
    source: row.source === "owner" ? "owner" : "seed",
    updatedAt: row.updated_at,
  };
}
