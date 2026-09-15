/**
 * Which repositories the App is installed on (decision 151), fed by the
 * `installation` and `installation_repositories` webhook events and
 * reconciled at boot by `review/registry.service.ts`.
 *
 * Its own table rather than a column anywhere: a new table reaches a deployed
 * database on open and a column needs the migration ladder (decision 25). The
 * key is the lowercased `owner/name` every other table uses, because GitHub
 * folds case and a delivery's spelling need not match an earlier one.
 *
 * `enabled` is the owner's switch and survives the App losing and regaining
 * the repository: a removed row keeps its flag under `removed_at` rather than
 * being deleted, so a reinstall does not silently turn review back on.
 */

import { type Db, normalizeRepo } from "./db";

export interface InstalledRepo {
  /** `owner/name` as GitHub spells it. */
  repo: string;
  installationId: number;
  isPrivate: boolean;
}

export interface RepositoryRow {
  /** The normalized key. */
  repo: string;
  /** As GitHub spells it. */
  displayName: string;
  installationId: number;
  isPrivate: boolean;
  enabled: boolean;
  addedAt: string;
  removedAt: string | null;
  updatedAt: string;
}

interface Row {
  repo: string;
  display_name: string;
  installation_id: number;
  is_private: number;
  enabled: number;
  added_at: string;
  removed_at: string | null;
  updated_at: string;
}

function toRow(row: Row): RepositoryRow {
  return {
    repo: row.repo,
    displayName: row.display_name,
    installationId: row.installation_id,
    isPrivate: row.is_private === 1,
    enabled: row.enabled === 1,
    addedAt: row.added_at,
    removedAt: row.removed_at,
    updatedAt: row.updated_at,
  };
}

export class RepositoryStore {
  constructor(private readonly db: Db) {}

  /**
   * Insert, or update an existing row in place: the spelling, the
   * installation and the visibility follow GitHub; `enabled` is left alone;
   * `removed_at` is cleared, because the App has the repository again.
   */
  upsertInstalled(entries: readonly InstalledRepo[], at: string): void {
    const stmt = this.db.prepare(
      "INSERT INTO repositories (repo, display_name, installation_id, is_private, enabled, added_at, removed_at, updated_at) " +
        "VALUES (?, ?, ?, ?, 1, ?, NULL, ?) " +
        "ON CONFLICT(repo) DO UPDATE SET display_name = excluded.display_name, " +
        "installation_id = excluded.installation_id, is_private = excluded.is_private, " +
        "removed_at = NULL, updated_at = excluded.updated_at",
    );
    for (const entry of entries) {
      stmt.run(
        normalizeRepo(entry.repo),
        entry.repo,
        entry.installationId,
        entry.isPrivate ? 1 : 0,
        at,
        at,
      );
    }
  }

  /**
   * The App lost these repositories. Rows stay, flagged, so `enabled`
   * survives. Returns the names actually flagged, so a caller logs a removal
   * only for a row that existed and was active: a name the table never held
   * is not a removal, whatever the delivery said.
   */
  markRemoved(repos: readonly string[], at: string): string[] {
    const stmt = this.db.prepare(
      "UPDATE repositories SET removed_at = ?, updated_at = ? WHERE repo = ? AND removed_at IS NULL",
    );
    const removed: string[] = [];
    for (const repo of repos) {
      if (Number(stmt.run(at, at, normalizeRepo(repo)).changes) === 1) removed.push(repo);
    }
    return removed;
  }

  /** The whole installation went: every active row under it is removed. */
  markInstallationRemoved(installationId: number, at: string): number {
    const result = this.db
      .prepare(
        "UPDATE repositories SET removed_at = ?, updated_at = ? WHERE installation_id = ? AND removed_at IS NULL",
      )
      .run(at, at, installationId);
    return Number(result.changes);
  }

  get(repo: string): RepositoryRow | null {
    const row = this.db
      .prepare("SELECT * FROM repositories WHERE repo = ?")
      .get(normalizeRepo(repo)) as Row | undefined;
    return row ? toRow(row) : null;
  }

  /** Every repository the App holds now, by name. */
  listActive(): RepositoryRow[] {
    const rows = this.db
      .prepare("SELECT * FROM repositories WHERE removed_at IS NULL ORDER BY repo")
      .all() as Row[];
    return rows.map(toRow);
  }

  listAll(): RepositoryRow[] {
    const rows = this.db.prepare("SELECT * FROM repositories ORDER BY repo").all() as Row[];
    return rows.map(toRow);
  }

  /** The owner's switch. Returns false when there is no row to flip. */
  setEnabled(repo: string, enabled: boolean, at: string): boolean {
    const result = this.db
      .prepare("UPDATE repositories SET enabled = ?, updated_at = ? WHERE repo = ?")
      .run(enabled ? 1 : 0, at, normalizeRepo(repo));
    return Number(result.changes) === 1;
  }

  /**
   * True only when a row exists and says so. An unknown repository is not
   * disabled: a delivery can arrive before the boot sync has seen it, and
   * "never heard of it" must not read as "told to ignore it".
   */
  isDisabled(repo: string): boolean {
    const row = this.db
      .prepare("SELECT enabled FROM repositories WHERE repo = ?")
      .get(normalizeRepo(repo)) as { enabled: number } | undefined;
    return row !== undefined && row.enabled === 0;
  }
}
