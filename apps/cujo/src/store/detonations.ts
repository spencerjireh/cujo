/**
 * What an exact specifier did when it was last installed here (decision 145).
 *
 * Keyed on `(source, specifier)` where the specifier names one immutable
 * thing — a registry version or a git commit — so the entry is the answer
 * for a week, whichever pull request or repository asks. The report stored
 * is the sensors' own entry for that install, sandbox-produced and already
 * scrubbed on its way out; it goes back into a box as data and nothing
 * else. `run_id` is the run that produced it, read beside `runs.is_public`
 * so a private run's id is never handed to a brief (decision 36).
 */

import type { Source } from "../review/specifiers";
import type { Db } from "./db";

export const DETONATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedDetonation {
  source: Source;
  specifier: string;
  report: unknown;
  runId: string;
  /** False when the run is gone or was never public; the id then stays home. */
  runIsPublic: boolean;
  createdAt: string;
}

/** One entry as a run was briefed with it, and as the fold reads it back (decision 148). */
export interface RunCachedDetonation {
  source: Source;
  specifier: string;
  report: unknown;
  /** The producing run's id when it was public, else null (decision 36). */
  cachedFromRun: string | null;
  cachedAt: string;
}

interface Row {
  source: string;
  specifier: string;
  report_json: string;
  run_id: string;
  created_at: string;
  is_public: number | null;
}

export class DetonationCacheStore {
  constructor(private readonly db: Db) {}

  /** The entry for a key, or null when there is none or it is older than the TTL. */
  get(source: Source, specifier: string, now: Date): CachedDetonation | null {
    const row = this.db
      .prepare(
        "SELECT c.source, c.specifier, c.report_json, c.run_id, c.created_at, r.is_public " +
          "FROM detonation_cache c LEFT JOIN runs r ON r.id = c.run_id " +
          "WHERE c.source = ? AND c.specifier = ?",
      )
      .get(source, specifier) as Row | undefined;
    if (!row) return null;
    if (Date.parse(row.created_at) < now.getTime() - DETONATION_CACHE_TTL_MS) return null;
    return {
      source: row.source as Source,
      specifier: row.specifier,
      report: JSON.parse(row.report_json),
      runId: row.run_id,
      runIsPublic: row.is_public === 1,
      createdAt: row.created_at,
    };
  }

  /** What a run was briefed with, so the fold can substitute it for the stub (decision 148). */
  putForRun(runId: string, entries: readonly RunCachedDetonation[]): void {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO run_detonation_cache (run_id, source, specifier, report_json, cached_from_run, cached_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const entry of entries) {
      insert.run(
        runId,
        entry.source,
        entry.specifier,
        JSON.stringify(entry.report),
        entry.cachedFromRun,
        entry.cachedAt,
      );
    }
  }

  /** The entries a run was briefed with, in the order they were written. */
  forRun(runId: string): RunCachedDetonation[] {
    const rows = this.db
      .prepare(
        "SELECT source, specifier, report_json, cached_from_run, cached_at FROM run_detonation_cache WHERE run_id = ? ORDER BY rowid",
      )
      .all(runId) as {
      source: string;
      specifier: string;
      report_json: string;
      cached_from_run: string | null;
      cached_at: string;
    }[];
    return rows.map((row) => ({
      source: row.source as Source,
      specifier: row.specifier,
      report: JSON.parse(row.report_json),
      cachedFromRun: row.cached_from_run,
      cachedAt: row.cached_at,
    }));
  }

  /** Write or replace the entry for a key, refreshing its stamp. */
  put(entry: {
    source: Source;
    specifier: string;
    report: unknown;
    runId: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO detonation_cache (source, specifier, report_json, run_id, created_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (source, specifier) DO UPDATE SET report_json = excluded.report_json, run_id = excluded.run_id, created_at = excluded.created_at",
      )
      .run(
        entry.source,
        entry.specifier,
        JSON.stringify(entry.report),
        entry.runId,
        entry.createdAt,
      );
  }
}
