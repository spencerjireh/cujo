/**
 * Durable state: settings manifests, sessions, turns, the event log, and
 * pending approvals. `node:sqlite`, like `apps/cujo`, so the image needs no
 * native module.
 *
 * The event log is the source of truth for everything a client reads
 * (`listEvents`, `subscribe` replay, `listTurns`); it is written synchronously
 * from the pi listener, which is what makes a sub-agent's report durable the
 * moment it lands rather than when its parent turn ends (decision 124). pi's
 * own transcript file is a separate concern: it is what lets the next turn
 * continue the conversation.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  AgentSpec,
  McpServerManifest,
  ModelProviderManifest,
  SessionEvent,
  SessionEventItem,
  Turn,
  TurnInputItem,
  TurnState,
} from "@cujo/harness-contract";

// Loaded through the runtime rather than an import so vitest's module
// transformer, which does not know node:sqlite, leaves it alone.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

export type Db = DatabaseSyncType;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    manifest TEXT NOT NULL,
    PRIMARY KEY (kind, name)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    spec TEXT NOT NULL,
    created_at TEXT NOT NULL,
    transcript_path TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    previous_turn_id TEXT,
    created_at TEXT NOT NULL,
    input TEXT NOT NULL,
    state TEXT NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS turns_by_session ON turns (session_id, seq);
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    event TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_by_session ON events (session_id, seq);
  CREATE TABLE IF NOT EXISTS approvals (
    tool_call_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    status TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS approvals_by_session ON approvals (session_id, status);
`;

export type ApprovalStatus = "pending" | "allowed" | "denied" | "superseded";

export interface ApprovalRow {
  toolCallId: string;
  sessionId: string;
  turnId: string;
  toolName: string;
  args: unknown;
  sourceEventId: string;
  status: ApprovalStatus;
}

export interface SessionRow {
  id: string;
  spec: AgentSpec;
  createdAt: string;
  transcriptPath: string;
}

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export class Store {
  constructor(private readonly db: Db) {}

  close(): void {
    this.db.close();
  }

  // -- settings -------------------------------------------------------------

  putMcpServer(manifest: McpServerManifest): void {
    this.putSetting("mcp-server", manifest.name, manifest);
  }

  getMcpServer(name: string): McpServerManifest | null {
    return this.getSetting<McpServerManifest>("mcp-server", name);
  }

  putModelProvider(manifest: ModelProviderManifest): void {
    this.putSetting("model-provider", manifest.name, manifest);
  }

  getModelProvider(name: string): ModelProviderManifest | null {
    return this.getSetting<ModelProviderManifest>("model-provider", name);
  }

  listModelProviders(): ModelProviderManifest[] {
    const rows = this.db
      .prepare("SELECT manifest FROM settings WHERE kind = 'model-provider' ORDER BY name")
      .all() as { manifest: string }[];
    return rows.map((row) => JSON.parse(row.manifest) as ModelProviderManifest);
  }

  private putSetting(kind: string, name: string, manifest: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings (kind, name, manifest) VALUES (?, ?, ?) ON CONFLICT (kind, name) DO UPDATE SET manifest = excluded.manifest",
      )
      .run(kind, name, JSON.stringify(manifest));
  }

  private getSetting<T>(kind: string, name: string): T | null {
    const row = this.db
      .prepare("SELECT manifest FROM settings WHERE kind = ? AND name = ?")
      .get(kind, name) as { manifest: string } | undefined;
    return row ? (JSON.parse(row.manifest) as T) : null;
  }

  // -- sessions -------------------------------------------------------------

  insertSession(row: SessionRow): void {
    this.db
      .prepare("INSERT INTO sessions (id, spec, created_at, transcript_path) VALUES (?, ?, ?, ?)")
      .run(row.id, JSON.stringify(row.spec), row.createdAt, row.transcriptPath);
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | { id: string; spec: string; created_at: string; transcript_path: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      spec: JSON.parse(row.spec) as AgentSpec,
      createdAt: row.created_at,
      transcriptPath: row.transcript_path,
    };
  }

  // -- turns ----------------------------------------------------------------

  insertTurn(turn: Omit<Turn, "state"> & { state: TurnState }): void {
    const seq = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM turns WHERE session_id = ?")
      .get(turn.sessionId) as { seq: number };
    this.db
      .prepare(
        "INSERT INTO turns (id, session_id, previous_turn_id, created_at, input, state, seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        turn.id,
        turn.sessionId,
        turn.previousTurnId,
        turn.createdAt,
        JSON.stringify(turn.input),
        JSON.stringify(turn.state),
        seq.seq,
      );
  }

  setTurnState(turnId: string, state: TurnState): void {
    this.db.prepare("UPDATE turns SET state = ? WHERE id = ?").run(JSON.stringify(state), turnId);
  }

  getTurn(id: string): Turn | null {
    const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as TurnRow | undefined;
    return row ? toTurn(row) : null;
  }

  listTurns(sessionId: string): Turn[] {
    const rows = this.db
      .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY seq")
      .all(sessionId) as TurnRow[];
    return rows.map(toTurn);
  }

  lastTurn(sessionId: string): Turn | null {
    const row = this.db
      .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
      .get(sessionId) as TurnRow | undefined;
    return row ? toTurn(row) : null;
  }

  listRunningTurns(): Turn[] {
    const rows = this.db
      .prepare('SELECT * FROM turns WHERE state = \'{"status":"running"}\' ORDER BY seq')
      .all() as TurnRow[];
    return rows.map(toTurn);
  }

  // -- events ---------------------------------------------------------------

  appendEvent(sessionId: string, turnId: string, event: SessionEvent): SessionEventItem {
    const result = this.db
      .prepare("INSERT INTO events (session_id, turn_id, thread_id, event) VALUES (?, ?, ?, ?)")
      .run(sessionId, turnId, event.threadId, JSON.stringify(event));
    return { seq: Number(result.lastInsertRowid), turnId, event };
  }

  listEvents(sessionId: string, afterSeq = 0): SessionEventItem[] {
    const rows = this.db
      .prepare(
        "SELECT seq, turn_id, event FROM events WHERE session_id = ? AND seq > ? ORDER BY seq",
      )
      .all(sessionId, afterSeq) as { seq: number; turn_id: string; event: string }[];
    return rows.map((row) => ({
      seq: row.seq,
      turnId: row.turn_id,
      event: JSON.parse(row.event) as SessionEvent,
    }));
  }

  listTurnEvents(sessionId: string, turnId: string): SessionEventItem[] {
    const rows = this.db
      .prepare(
        "SELECT seq, turn_id, event FROM events WHERE session_id = ? AND turn_id = ? ORDER BY seq",
      )
      .all(sessionId, turnId) as { seq: number; turn_id: string; event: string }[];
    return rows.map((row) => ({
      seq: row.seq,
      turnId: row.turn_id,
      event: JSON.parse(row.event) as SessionEvent,
    }));
  }

  // -- approvals ------------------------------------------------------------

  insertApproval(row: Omit<ApprovalRow, "status">): void {
    this.db
      .prepare(
        "INSERT INTO approvals (tool_call_id, session_id, turn_id, tool_name, args, source_event_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      )
      .run(
        row.toolCallId,
        row.sessionId,
        row.turnId,
        row.toolName,
        JSON.stringify(row.args ?? null),
        row.sourceEventId,
      );
  }

  getApproval(toolCallId: string): ApprovalRow | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE tool_call_id = ?").get(toolCallId) as
      | ApprovalDbRow
      | undefined;
    return row ? toApproval(row) : null;
  }

  /** Marks one approval decided; returns false when it was not pending. */
  decideApproval(toolCallId: string, status: Exclude<ApprovalStatus, "pending">): boolean {
    const result = this.db
      .prepare(
        "UPDATE approvals SET status = ?, decided_at = ? WHERE tool_call_id = ? AND status = 'pending'",
      )
      .run(status, new Date().toISOString(), toolCallId);
    return result.changes > 0;
  }

  supersedePendingApprovals(sessionId: string): number {
    const result = this.db
      .prepare(
        "UPDATE approvals SET status = 'superseded', decided_at = ? WHERE session_id = ? AND status = 'pending'",
      )
      .run(new Date().toISOString(), sessionId);
    return Number(result.changes);
  }
}

interface TurnRow {
  id: string;
  session_id: string;
  previous_turn_id: string | null;
  created_at: string;
  input: string;
  state: string;
}

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    previousTurnId: row.previous_turn_id,
    input: JSON.parse(row.input) as TurnInputItem[],
    state: JSON.parse(row.state) as TurnState,
  };
}

interface ApprovalDbRow {
  tool_call_id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  args: string;
  source_event_id: string;
  status: ApprovalStatus;
}

function toApproval(row: ApprovalDbRow): ApprovalRow {
  return {
    toolCallId: row.tool_call_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    toolName: row.tool_name,
    args: JSON.parse(row.args),
    sourceEventId: row.source_event_id,
    status: row.status,
  };
}
