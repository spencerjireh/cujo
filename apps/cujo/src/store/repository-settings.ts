/**
 * What an owner set for one repository on the board (decision 155): the
 * review mode and the instructions. The board is the fallback layer —
 * `deploy default < board < repository file` — so a null here means "the
 * board says nothing", and the file at base or the instance's default answers
 * instead. Its own table, keyed like every other one, so a new key reaches a
 * deployed database on open (decision 25).
 */

import type { ReviewMode } from "../review/types";
import { type Db, normalizeRepo } from "./db";

export interface RepositorySettings {
  mode: ReviewMode | null;
  instructions: string | null;
  updatedAt: string | null;
}

interface Row {
  mode: string | null;
  instructions: string | null;
  updated_at: string;
}

export class RepositorySettingsStore {
  constructor(private readonly db: Db) {}

  get(repo: string): RepositorySettings {
    const row = this.db
      .prepare("SELECT mode, instructions, updated_at FROM repository_settings WHERE repo = ?")
      .get(normalizeRepo(repo)) as Row | undefined;
    if (!row) return { mode: null, instructions: null, updatedAt: null };
    return {
      mode: row.mode === "sandbox" || row.mode === "diff" ? row.mode : null,
      instructions: row.instructions,
      updatedAt: row.updated_at,
    };
  }

  /** Writes the keys given; a key absent from the patch keeps its value, null clears it. */
  set(
    repo: string,
    patch: Partial<Pick<RepositorySettings, "mode" | "instructions">>,
    at: string,
  ): RepositorySettings {
    const current = this.get(repo);
    const mode = "mode" in patch ? (patch.mode ?? null) : current.mode;
    const instructions =
      "instructions" in patch ? (patch.instructions ?? null) : current.instructions;
    this.db
      .prepare(
        "INSERT INTO repository_settings (repo, mode, instructions, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(repo) DO UPDATE SET mode = excluded.mode, instructions = excluded.instructions, " +
          "updated_at = excluded.updated_at",
      )
      .run(normalizeRepo(repo), mode, instructions, at);
    return { mode, instructions, updatedAt: at };
  }
}
