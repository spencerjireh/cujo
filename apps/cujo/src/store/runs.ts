/**
 * The run store: the PR-to-session map, one row per run, the folded projection
 * of each run, the resume turns Cujo itself sent, and the PR title the card
 * needs.
 *
 * It takes a NotificationStore because deleting a run has to delete the card
 * posted for it, and that is not optional: on the stale-reclaim path inside
 * `createRun` the message row must go before the unique index on
 * (repo, pr_number, head_sha) will admit the replacement. A required
 * constructor argument rather than an optional callback, so a caller that
 * forgets it is a compile error instead of a run whose card outlives it.
 */

import { randomUUID } from "node:crypto";
import type { Projection, RunRecord, RunStatus } from "../review/types";
import type { Db } from "./db";
import type { NotificationStore } from "./notifications";

interface RunRow {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  session_id: string;
  turn_ids: string;
  status: string;
  approver: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    repo: row.repo,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    sessionId: row.session_id,
    turnIds: JSON.parse(row.turn_ids) as string[],
    status: row.status as RunStatus,
    approver: row.approver,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RunStore {
  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationStore,
  ) {}

  getSession(repo: string, prNumber: number): string | null {
    const row = this.db
      .prepare("SELECT session_id FROM sessions WHERE repo = ? AND pr_number = ?")
      .get(repo, prNumber) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /**
   * First writer wins. Returns the session id now stored, which is the
   * caller's only when no other delivery got there first.
   */
  putSession(repo: string, prNumber: number, sessionId: string): string {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (repo, pr_number, session_id) VALUES (?, ?, ?)")
      .run(repo, prNumber, sessionId);
    const stored = this.getSession(repo, prNumber);
    if (!stored) throw new Error("session vanished after insert");
    return stored;
  }

  /**
   * Atomic claim of the run for a PR head. `created` is false when a run for
   * that head already exists, in which case the existing run is returned.
   *
   * A run that errored before it ever had a turn holds nothing worth keeping,
   * so its row is re-claimed: a redelivery then reviews the head instead of
   * being answered "duplicate delivery" forever.
   */
  createRun(input: {
    repo: string;
    prNumber: number;
    headSha: string;
    sessionId: string;
  }): { run: RunRecord; created: boolean } {
    const now = new Date().toISOString();
    const id = randomUUID();
    const stale = this.db
      .prepare(
        "SELECT id FROM runs WHERE repo = ? AND pr_number = ? AND head_sha = ? " +
          "AND status = 'error' AND turn_ids = '[]'",
      )
      .get(input.repo, input.prNumber, input.headSha) as { id: string } | undefined;
    if (stale) this.deleteRun(stale.id);
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO runs (id, repo, pr_number, head_sha, session_id, turn_ids, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, '[]', 'running', ?, ?)",
      )
      .run(id, input.repo, input.prNumber, input.headSha, input.sessionId, now, now);
    const row = this.db
      .prepare("SELECT * FROM runs WHERE repo = ? AND pr_number = ? AND head_sha = ?")
      .get(input.repo, input.prNumber, input.headSha) as RunRow | undefined;
    if (!row) throw new Error("run vanished after insert");
    return { run: toRecord(row), created: Number(result.changes) === 1 };
  }

  deleteRun(id: string): void {
    this.db.prepare("DELETE FROM run_projections WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM run_cujo_turns WHERE run_id = ?").run(id);
    this.notifications.deleteRunMessages(id);
    this.db.prepare("DELETE FROM run_pr_meta WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  addCujoTurn(runId: string, turnId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO run_cujo_turns (run_id, turn_id) VALUES (?, ?)")
      .run(runId, turnId);
  }

  listCujoTurns(runId: string): string[] {
    const rows = this.db
      .prepare("SELECT turn_id FROM run_cujo_turns WHERE run_id = ?")
      .all(runId) as { turn_id: string }[];
    return rows.map((r) => r.turn_id);
  }

  /** Every run that shares a session, so one run can skip the others' turns. */
  listRunsForSession(sessionId: string): RunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as RunRow[];
    return rows.map(toRecord);
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? toRecord(row) : null;
  }

  listRuns(limit = 100): RunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as RunRow[];
    return rows.map(toRecord);
  }

  listUnfinishedRuns(scope?: { repo: string; prNumber: number }): RunRecord[] {
    const where = "status IN ('running', 'blocked_pending')";
    const rows = (
      scope
        ? this.db
            .prepare(
              `SELECT * FROM runs WHERE ${where} AND repo = ? AND pr_number = ? ORDER BY created_at`,
            )
            .all(scope.repo, scope.prNumber)
        : this.db.prepare(`SELECT * FROM runs WHERE ${where} ORDER BY created_at`).all()
    ) as RunRow[];
    return rows.map(toRecord);
  }

  updateRun(
    id: string,
    patch: { status?: RunStatus; turnIds?: string[]; approver?: string; decidedAt?: string },
  ): RunRecord | null {
    const current = this.getRun(id);
    if (!current) return null;
    this.db
      .prepare(
        "UPDATE runs SET status = ?, turn_ids = ?, approver = ?, decided_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        patch.status ?? current.status,
        JSON.stringify(patch.turnIds ?? current.turnIds),
        patch.approver ?? current.approver,
        patch.decidedAt ?? current.decidedAt,
        new Date().toISOString(),
        id,
      );
    return this.getRun(id);
  }

  /**
   * Compare-and-set the decision: succeeds for exactly one caller while the
   * run is blocked_pending and undecided, so a second approve request cannot
   * resume the same call.
   */
  claimDecision(id: string, approver: string, decidedAt: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE runs SET approver = ?, decided_at = ?, updated_at = ? " +
          "WHERE id = ? AND status = 'blocked_pending' AND approver IS NULL",
      )
      .run(approver, decidedAt, new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  /** Undo a claim whose resume never reached the harness, so a retry is possible. */
  clearDecision(id: string): void {
    this.db
      .prepare("UPDATE runs SET approver = NULL, decided_at = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  putProjection(runId: string, projection: Projection): void {
    this.db
      .prepare(
        "INSERT INTO run_projections (run_id, projection) VALUES (?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET projection = excluded.projection",
      )
      .run(runId, JSON.stringify(projection));
  }

  getProjection(runId: string): Projection | null {
    const row = this.db
      .prepare("SELECT projection FROM run_projections WHERE run_id = ?")
      .get(runId) as { projection: string } | undefined;
    return row ? (JSON.parse(row.projection) as Projection) : null;
  }

  putRunPrTitle(runId: string, title: string): void {
    this.db
      .prepare(
        "INSERT INTO run_pr_meta (run_id, title, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET title = excluded.title, " +
          "updated_at = excluded.updated_at",
      )
      .run(runId, title, new Date().toISOString());
  }

  getRunPrTitle(runId: string): string | null {
    const row = this.db.prepare("SELECT title FROM run_pr_meta WHERE run_id = ?").get(runId) as
      | { title: string }
      | undefined;
    return row?.title ?? null;
  }
}
