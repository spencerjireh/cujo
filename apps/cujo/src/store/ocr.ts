/**
 * What Open Code Review said about a run (decision 149), kept verbatim and
 * read by nobody in this process: the comparison is done by hand over SQL
 * during the measurement week, and the row never reaches `/public`, the
 * board, or a pull request. Its own table rather than a column on `runs`,
 * because a new table reaches a deployed database on open and a column needs
 * the migration ladder for no gain (decision 25).
 */

import type { Db } from "./db";

export interface OcrReviewRow {
  runId: string;
  provider: string;
  status: "running" | "ok" | "error";
  /** The sidecar's JSON envelope as text, when it answered with one. */
  resultJson: string | null;
  error: string | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

interface Row {
  run_id: string;
  provider: string;
  status: string;
  result_json: string | null;
  error: string | null;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export class OcrReviewStore {
  constructor(private readonly db: Db) {}

  markStarted(runId: string, provider: string, at: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO run_ocr_reviews " +
          "(run_id, provider, status, result_json, error, exit_code, started_at, finished_at, duration_ms) " +
          "VALUES (?, ?, 'running', NULL, NULL, NULL, ?, NULL, NULL)",
      )
      .run(runId, provider, at);
  }

  finish(
    runId: string,
    outcome: {
      status: "ok" | "error";
      resultJson: string | null;
      error: string | null;
      exitCode: number | null;
      durationMs: number | null;
    },
    at: string,
  ): void {
    this.db
      .prepare(
        "UPDATE run_ocr_reviews SET status = ?, result_json = ?, error = ?, exit_code = ?, " +
          "finished_at = ?, duration_ms = ? WHERE run_id = ?",
      )
      .run(
        outcome.status,
        outcome.resultJson,
        outcome.error,
        outcome.exitCode,
        at,
        outcome.durationMs,
        runId,
      );
  }

  get(runId: string): OcrReviewRow | null {
    const row = this.db.prepare("SELECT * FROM run_ocr_reviews WHERE run_id = ?").get(runId) as
      | Row
      | undefined;
    if (!row) return null;
    return {
      runId: row.run_id,
      provider: row.provider,
      status: row.status as OcrReviewRow["status"],
      resultJson: row.result_json,
      error: row.error,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
    };
  }
}
