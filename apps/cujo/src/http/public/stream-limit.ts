/**
 * A cap on how many public run streams may be open at once (decision 34).
 *
 * The edge rate-limits requests per address; this bounds the connections one
 * process holds, which is a different failure and gets a different answer. An
 * SSE stream is an open socket and a keepalive timer for as long as the run is
 * live, and a `blocked_pending` run can be live for hours, so the realistic
 * pressure here is idle tabs rather than an attacker.
 *
 * Counts public streams only. An operator must never lose the approval page
 * because the board is busy, which is why this lives on the public plane and
 * not in `operator/runs.ts`.
 */

export interface StreamLimit {
  /** False when the cap is reached; the caller must then not open a stream. */
  acquire(): boolean;
  /** Idempotent per acquire, so a double release cannot free a slot twice. */
  release(): void;
  active(): number;
}

/**
 * One counter per app instance, never module-level: module state would leak
 * between tests and make `active()` unassertable.
 */
export function createStreamLimit(max: number): StreamLimit {
  let active = 0;
  return {
    acquire() {
      if (active >= max) return false;
      active += 1;
      return true;
    },
    release() {
      if (active > 0) active -= 1;
    },
    active: () => active,
  };
}
