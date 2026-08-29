/**
 * The run store: the PR-to-session map, one row per run, the folded projection
 * of each run, the resume turns Cujo itself sent, and what the pull request
 * says about itself — its title, and who opened it.
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
  is_public: number | null;
  delivery_id: string | null;
  model: string | null;
  rubric_sha256: string | null;
  created_at: string;
  updated_at: string;
  /** From the join below, not from `runs`. Null until the PR read completed. */
  pr_title: string | null;
  pr_author_login: string | null;
  pr_author_id: number | null;
}

/**
 * Every run read, so `RunRecord` always carries what the pull request says
 * about itself (decision 55). A LEFT JOIN rather than a second lookup: a card
 * and a run page both want the title and the author, and one of them is on the
 * SSE path where a second query per event would be a second query per event.
 *
 * `meta.updated_at` is deliberately not selected — `runs.updated_at` is the one
 * every caller means — and columns are qualified below wherever both tables
 * have them, `rowid` included.
 */
const RUN_SELECT =
  "SELECT runs.*, meta.title AS pr_title, meta.author_login AS pr_author_login, " +
  "meta.author_id AS pr_author_id FROM runs " +
  "LEFT JOIN run_pr_meta meta ON meta.run_id = runs.id";

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
    // The one place NULL collapses to false. A row written before the column
    // existed, or by a path that never learned the answer, is not public.
    isPublic: row.is_public === 1,
    deliveryId: row.delivery_id,
    model: row.model,
    rubricSha256: row.rubric_sha256,
    prTitle: row.pr_title,
    prAuthorLogin: row.pr_author_login,
    prAuthorId: row.pr_author_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RunStore {
  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationStore,
  ) {}

  /**
   * The cheapest possible "is the database answering", for `/readyz`
   * (decision 37). Deliberately not `listRunRepos()`, which is a full scan: a
   * readiness probe runs every few seconds for the life of the container.
   */
  ping(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

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
   * The conversation session for a pull request, or null before anyone has
   * asked anything.
   *
   * Separate from `getSession` above and never interchangeable with it: a turn
   * on the review's session cancels a live review, is refused while its
   * approval is pending, and corrupts the run's projection (decision 47). Two
   * accessors that look alike is the point — the type system cannot tell these
   * ids apart, so the names have to.
   *
   * `COLLATE NOCASE`, unlike the review pair, because `runs.repo` holds
   * whatever casing GitHub sent and a comment delivery is not guaranteed to
   * match the pull request delivery that created the review session.
   */
  getConversationSession(repo: string, prNumber: number): string | null {
    const row = this.db
      .prepare(
        "SELECT session_id FROM conversation_sessions WHERE repo = ? COLLATE NOCASE AND pr_number = ?",
      )
      .get(repo, prNumber) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /** First writer wins, like `putSession`. Returns the id now stored. */
  putConversationSession(repo: string, prNumber: number, sessionId: string): string {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO conversation_sessions (repo, pr_number, session_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(repo, prNumber, sessionId, new Date().toISOString());
    const stored = this.getConversationSession(repo, prNumber);
    if (!stored) throw new Error("conversation session vanished after insert");
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
    /**
     * Required rather than defaulted: an optional field would compile at every
     * call site and silently mark real public runs private (decision 34).
     */
    isPublic: boolean;
    /**
     * The delivery that claimed it. Optional because only the webhook has one
     * — a run created by a test or a future path legitimately has none, and
     * `null` says so rather than pretending.
     */
    deliveryId?: string | null;
    /**
     * What this process was configured with when it claimed the run: the model
     * name, and a digest of the instructions it would hand a new session.
     * Optional because a test or a future path may not hold either, and `null`
     * says "not recorded" rather than naming a model that was never used.
     */
    model?: string | null;
    rubricSha256?: string | null;
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
        "INSERT OR IGNORE INTO runs (id, repo, pr_number, head_sha, session_id, turn_ids, status, is_public, delivery_id, model, rubric_sha256, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, '[]', 'running', ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.repo,
        input.prNumber,
        input.headSha,
        input.sessionId,
        input.isPublic ? 1 : 0,
        input.deliveryId ?? null,
        input.model ?? null,
        input.rubricSha256 ?? null,
        now,
        now,
      );
    const row = this.db
      .prepare(`${RUN_SELECT} WHERE runs.repo = ? AND runs.pr_number = ? AND runs.head_sha = ?`)
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
      .prepare(`${RUN_SELECT} WHERE runs.session_id = ? ORDER BY runs.created_at`)
      .all(sessionId) as RunRow[];
    return rows.map(toRecord);
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare(`${RUN_SELECT} WHERE runs.id = ?`).get(id) as RunRow | undefined;
    return row ? toRecord(row) : null;
  }

  listRuns(limit = 100): RunRecord[] {
    const rows = this.db
      .prepare(`${RUN_SELECT} ORDER BY runs.created_at DESC LIMIT ?`)
      .all(limit) as RunRow[];
    return rows.map(toRecord);
  }

  /**
   * What the public plane lists (decision 34). The filter is in the query and
   * not in the caller: filtering `listRuns()` after its own LIMIT would return
   * fewer than `limit` rows and silently hide the tail, and a route that forgot
   * to filter would return everything.
   */
  listPublicRuns(limit = 100): RunRecord[] {
    const rows = this.db
      .prepare(`${RUN_SELECT} WHERE runs.is_public = 1 ORDER BY runs.created_at DESC LIMIT ?`)
      .all(limit) as RunRow[];
    return rows.map(toRecord);
  }

  /**
   * Re-stamp every run of one repo after a visibility flip. Returns the number
   * of rows changed, so a webhook delivery log says whether it mattered.
   *
   * `COLLATE NOCASE` because `runs.repo` stores `repository.full_name`
   * verbatim — `normalizeRepo` is the notifications store's convention, not
   * this one — and GitHub treats the name case-insensitively. It costs a table
   * scan, since `runs_head` is a BINARY index; that is one scan per flip.
   */
  setRepoVisibility(repo: string, isPublic: boolean): number {
    const result = this.db
      .prepare("UPDATE runs SET is_public = ? WHERE repo = ? COLLATE NOCASE AND is_public IS NOT ?")
      .run(isPublic ? 1 : 0, repo, isPublic ? 1 : 0);
    return Number(result.changes);
  }

  /** Every repo that has a run, for the visibility sweep to re-ask about. */
  listRunRepos(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT repo FROM runs").all() as { repo: string }[];
    return rows.map((r) => r.repo);
  }

  /**
   * The newest run for a pull request, whatever state it is in.
   *
   * There was no lookup by pull request: the existing composition is
   * `getSession` then `listRunsForSession`, which returns every run on the pull
   * request including terminal ones and leaves the caller to sort them. A
   * comment names a pull request and nothing else, so this is the shape that
   * question actually has.
   *
   * `COLLATE NOCASE` because `runs.repo` holds whatever casing GitHub sent and
   * a webhook is not guaranteed to send the same casing twice —
   * `setRepoVisibility` already compares this way, and `listUnfinishedRuns`
   * below does not, which is a difference nobody chose.
   */
  latestRunForPr(repo: string, prNumber: number): RunRecord | null {
    const row = this.db
      .prepare(
        `${RUN_SELECT} WHERE runs.repo = ? COLLATE NOCASE AND runs.pr_number = ? ORDER BY runs.created_at DESC, runs.rowid DESC LIMIT 1`,
      )
      .get(repo, prNumber) as RunRow | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * The run for one exact commit on a pull request.
   *
   * This, and not `latestRunForPr`, is what a command resolves against. Local
   * insertion order is not commit order: a delivery for an older head that
   * arrived late is the newest row here while being the oldest commit there,
   * and answering it would refuse a command aimed at the run a person is
   * actually reading. The head comes from GitHub, so the commit decides.
   *
   * `runs_head` is unique on `(repo, pr_number, head_sha)`, so there is at most
   * one row per casing; the ordering is only for a repo that arrived spelled
   * two ways.
   */
  runForPrHead(repo: string, prNumber: number, headSha: string): RunRecord | null {
    const row = this.db
      .prepare(
        `${RUN_SELECT} WHERE runs.repo = ? COLLATE NOCASE AND runs.pr_number = ? AND runs.head_sha = ? ORDER BY runs.created_at DESC, runs.rowid DESC LIMIT 1`,
      )
      .get(repo, prNumber, headSha) as RunRow | undefined;
    return row ? toRecord(row) : null;
  }

  listUnfinishedRuns(scope?: { repo: string; prNumber: number }): RunRecord[] {
    // A SQL string, so the type system cannot check it and a missing status is
    // silent: a run in one nobody added here is never rehydrated on restart and
    // never superseded by a newer head. `blocked_unattended` is left out on
    // purpose — that run posted its review and is done, so re-following it or
    // cancelling its turn would act on a finished run.
    const where = "status IN ('running', 'blocked_pending')";
    const rows = (
      scope
        ? this.db
            .prepare(
              `${RUN_SELECT} WHERE ${where} AND runs.repo = ? AND runs.pr_number = ? ORDER BY runs.created_at`,
            )
            .all(scope.repo, scope.prNumber)
        : this.db.prepare(`${RUN_SELECT} WHERE ${where} ORDER BY runs.created_at`).all()
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

  /**
   * What the pull request says about itself, written once when the run is
   * claimed. There is no matching getter: `RUN_SELECT` joins this row onto
   * every run read, so a caller that has a `RunRecord` already has it.
   */
  putRunPrMeta(
    runId: string,
    meta: { title: string; authorLogin: string | null; authorId: number | null },
  ): void {
    this.db
      .prepare(
        "INSERT INTO run_pr_meta (run_id, title, author_login, author_id, updated_at) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (run_id) DO UPDATE SET title = excluded.title, " +
          "author_login = excluded.author_login, author_id = excluded.author_id, " +
          "updated_at = excluded.updated_at",
      )
      .run(runId, meta.title, meta.authorLogin, meta.authorId, new Date().toISOString());
  }
}
