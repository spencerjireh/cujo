/**
 * Whether a pull request is still open (decision 179).
 *
 * Cujo starts runs on `opened`, `synchronize` and `ready_for_review` and used
 * to ignore `closed`, so the owner's pages listed a merged pull request's
 * failed run as something to act on. This holds the one fact that was
 * missing, per pull request rather than per run: a close ends the pull
 * request, not one of its heads.
 *
 * No row means not known, which every reader treats as open. A delivery
 * older than what is stored is ignored, so a `closed` that arrives after the
 * `reopened` that followed it cannot close the pull request again.
 */

import type { Db } from "./db";

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequestKey {
  repo: string;
  prNumber: number;
}

export class PullRequestStore {
  constructor(private readonly db: Db) {}

  /** Records a state as of `at`; false when something newer is already stored. */
  set(key: PullRequestKey, state: PullRequestState, closedAt: string | null, at: Date): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO pull_requests (repo, pr_number, state, closed_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (repo, pr_number) DO UPDATE SET
           state = excluded.state, closed_at = excluded.closed_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at >= pull_requests.updated_at`,
      )
      .run(key.repo, key.prNumber, state, closedAt, at.toISOString());
    return Number(result.changes) > 0;
  }

  get(key: PullRequestKey): PullRequestState | null {
    const row = this.db
      .prepare("SELECT state FROM pull_requests WHERE repo = ? AND pr_number = ?")
      .get(key.repo, key.prNumber) as { state: PullRequestState } | undefined;
    return row?.state ?? null;
  }

  /** Every known state among `keys`, keyed `lower(repo)#number`. */
  states(keys: readonly PullRequestKey[]): Map<string, PullRequestState> {
    const out = new Map<string, PullRequestState>();
    if (keys.length === 0) return out;
    const wanted = new Set(keys.map(stateKey));
    const repos = [...new Set(keys.map((k) => k.repo.toLowerCase()))];
    const rows = this.db
      .prepare(
        `SELECT repo, pr_number, state FROM pull_requests
          WHERE lower(repo) IN (${repos.map(() => "?").join(", ")})`,
      )
      .all(...repos) as { repo: string; pr_number: number; state: PullRequestState }[];
    for (const row of rows) {
      const k = stateKey({ repo: row.repo, prNumber: row.pr_number });
      if (wanted.has(k)) out.set(k, row.state);
    }
    return out;
  }

  /** Pull requests that have runs and no known state: what the backfill asks GitHub about. */
  unknownWithRuns(): PullRequestKey[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT runs.repo, runs.pr_number FROM runs
           LEFT JOIN pull_requests p
             ON p.repo = runs.repo COLLATE NOCASE AND p.pr_number = runs.pr_number
          WHERE p.state IS NULL
          ORDER BY runs.repo, runs.pr_number`,
      )
      .all() as { repo: string; pr_number: number }[];
    return rows.map((row) => ({ repo: row.repo, prNumber: row.pr_number }));
  }
}

export function stateKey(key: PullRequestKey): string {
  return `${key.repo.toLowerCase()}#${key.prNumber}`;
}
