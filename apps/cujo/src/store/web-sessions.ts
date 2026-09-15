/**
 * Who is signed in to the board (decision 153).
 *
 * Two tables. `web_logins` holds the `state` of a sign-in that has started
 * and not come back yet, so the callback can refuse a code it did not ask
 * for. `web_sessions` holds a signed-in person: the login GitHub gave, the
 * owner verdict made at sign-in, and an expiry. The session id the browser
 * carries is stored hashed, the way a password would be, so a copy of the
 * database is not a copy of every session.
 *
 * The person's GitHub token is used once, at sign-in, and never stored.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

export interface WebSession {
  login: string;
  userId: number;
  isOwner: boolean;
  createdAt: string;
  expiresAt: string;
}

/** Ten minutes: a sign-in that takes longer was abandoned. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;
/** A week, after which the owner verdict is made again by signing in again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export class WebSessionStore {
  constructor(private readonly db: Db) {}

  /** A new sign-in: the state the callback must echo. */
  startLogin(at: Date): string {
    const state = randomBytes(24).toString("hex");
    this.db
      .prepare("INSERT INTO web_logins (state, created_at) VALUES (?, ?)")
      .run(state, at.toISOString());
    return state;
  }

  /** Consumes a state; true only for one that exists and is young enough. */
  finishLogin(state: string, at: Date): boolean {
    const row = this.db.prepare("SELECT created_at FROM web_logins WHERE state = ?").get(state) as
      | { created_at: string }
      | undefined;
    this.db.prepare("DELETE FROM web_logins WHERE state = ?").run(state);
    if (!row) return false;
    return Date.parse(row.created_at) >= at.getTime() - LOGIN_TTL_MS;
  }

  /** Creates a session and returns the id the browser will carry. */
  create(session: Omit<WebSession, "createdAt" | "expiresAt">, at: Date): string {
    const id = randomBytes(32).toString("hex");
    this.db
      .prepare(
        "INSERT INTO web_sessions (id_hash, login, user_id, is_owner, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        hash(id),
        session.login,
        session.userId,
        session.isOwner ? 1 : 0,
        at.toISOString(),
        new Date(at.getTime() + SESSION_TTL_MS).toISOString(),
      );
    return id;
  }

  /** The session for an id, or null when there is none or it has expired. */
  get(id: string, at: Date): WebSession | null {
    const row = this.db
      .prepare(
        "SELECT login, user_id, is_owner, created_at, expires_at FROM web_sessions WHERE id_hash = ?",
      )
      .get(hash(id)) as
      | { login: string; user_id: number; is_owner: number; created_at: string; expires_at: string }
      | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= at.getTime()) return null;
    return {
      login: row.login,
      userId: row.user_id,
      isOwner: row.is_owner === 1,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM web_sessions WHERE id_hash = ?").run(hash(id));
    return Number(result.changes) === 1;
  }

  /** Drops expired sessions and stale logins. Returns how many rows went. */
  sweep(at: Date): number {
    const sessions = this.db
      .prepare("DELETE FROM web_sessions WHERE expires_at <= ?")
      .run(at.toISOString());
    const logins = this.db
      .prepare("DELETE FROM web_logins WHERE created_at < ?")
      .run(new Date(at.getTime() - LOGIN_TTL_MS).toISOString());
    return Number(sessions.changes) + Number(logins.changes);
  }
}
