/**
 * What the executor ran for a run, and the box it ran in (decision 161).
 *
 * Kept beside the run rather than in its projection, because the projection
 * is folded from events and these are not events: a check the trusted side
 * executed has no thread. The runner reads the rows into `FoldOptions` on
 * every fold, so a refold or a rehydrate after a restart sees the same
 * checks the live fold did. The box row is what lets a restart destroy a
 * sandbox it still owes.
 */
import type { Db } from "./db";

export interface ExecutedCheckRow {
  runId: string;
  check: string;
  report: unknown;
  startedAt: string;
  endedAt: string;
}

export interface RunSandboxRow {
  runId: string;
  sandboxId: string;
  provisionedMs: number;
  env: Record<string, string>;
  destroyedAt: string | null;
}

interface ExecRow {
  run_id: string;
  check_name: string;
  report_json: string;
  started_at: string;
  ended_at: string;
}

interface BoxRow {
  run_id: string;
  sandbox_id: string;
  provisioned_ms: number;
  env_json: string;
  destroyed_at: string | null;
}

export class ExecutionStore {
  constructor(private readonly db: Db) {}

  putCheck(row: ExecutedCheckRow): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO run_executions (run_id, check_name, report_json, started_at, ended_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.runId, row.check, JSON.stringify(row.report), row.startedAt, row.endedAt);
  }

  /** Every executed check of a run, in the order they were recorded. */
  checksForRun(runId: string): ExecutedCheckRow[] {
    const rows = this.db
      .prepare("SELECT * FROM run_executions WHERE run_id = ? ORDER BY started_at, check_name")
      .all(runId) as unknown as ExecRow[];
    return rows.map((row) => ({
      runId: row.run_id,
      check: row.check_name,
      report: JSON.parse(row.report_json) as unknown,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }));
  }

  putSandbox(row: Omit<RunSandboxRow, "destroyedAt">): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO run_sandboxes (run_id, sandbox_id, provisioned_ms, env_json, destroyed_at) " +
          "VALUES (?, ?, ?, ?, NULL)",
      )
      .run(row.runId, row.sandboxId, row.provisionedMs, JSON.stringify(row.env));
  }

  sandboxForRun(runId: string): RunSandboxRow | null {
    const row = this.db.prepare("SELECT * FROM run_sandboxes WHERE run_id = ?").get(runId) as
      | BoxRow
      | undefined;
    return row ? toSandbox(row) : null;
  }

  markDestroyed(runId: string, at: string): void {
    this.db
      .prepare(
        "UPDATE run_sandboxes SET destroyed_at = ? WHERE run_id = ? AND destroyed_at IS NULL",
      )
      .run(at, runId);
  }

  /** Boxes never marked destroyed: what a restart owes the sandbox service. */
  listUndestroyed(): RunSandboxRow[] {
    const rows = this.db
      .prepare("SELECT * FROM run_sandboxes WHERE destroyed_at IS NULL")
      .all() as unknown as BoxRow[];
    return rows.map(toSandbox);
  }
}

function toSandbox(row: BoxRow): RunSandboxRow {
  return {
    runId: row.run_id,
    sandboxId: row.sandbox_id,
    provisionedMs: row.provisioned_ms,
    env: JSON.parse(row.env_json) as Record<string, string>,
    destroyedAt: row.destroyed_at,
  };
}
