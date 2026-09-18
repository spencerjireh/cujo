/**
 * The build facts a run was briefed with (decision 170).
 *
 * Written before the turn exists and read back by the fold, which is the
 * whole reason the row is here: the findings these facts imply are derived on
 * the trusted side, and a refold after a restart has no network to re-read
 * GitHub with. The same shape as the executed checks and the briefed
 * detonations — compute once, store, brief, and let every later fold read the
 * stored copy rather than a fresh one.
 *
 * Its own table rather than a column on `runs`, because a new table reaches a
 * deployed database on open and a column needs the migration ladder for no
 * gain (decision 25).
 */

import type { BuildFacts } from "../review/build-facts";
import type { Db } from "./db";

interface Row {
  facts_json: string;
}

export class BuildFactsStore {
  constructor(private readonly db: Db) {}

  /** Record what this run was briefed with. Idempotent: a re-run replaces it. */
  putForRun(runId: string, facts: BuildFacts, at: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO run_build_facts (run_id, facts_json, recorded_at) VALUES (?, ?, ?)",
      )
      .run(runId, JSON.stringify(facts), at);
  }

  /**
   * The facts this run carried, or null when it carried none — a sandbox run,
   * or any run from before this table existed. Null and not an empty block:
   * "there were no facts" and "this run never read any" are different, and
   * only one of them should reach a fold.
   */
  forRun(runId: string): BuildFacts | null {
    const row = this.db
      .prepare("SELECT facts_json FROM run_build_facts WHERE run_id = ?")
      .get(runId) as Row | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.facts_json) as BuildFacts;
    } catch {
      // Stored by this process, so this cannot happen without the file being
      // edited underneath us; a fold that lost its facts is better than one
      // that throws on a row it only wanted for a footnote.
      return null;
    }
  }
}
