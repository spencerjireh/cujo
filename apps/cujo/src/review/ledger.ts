/**
 * Where a run's tokens went, thread by thread.
 *
 * `usage` on the projection is the turn's total, computed by the harness, and
 * a check's `usage` is the sum of its own thread's messages. Neither says what
 * the parent cost, and neither says which tool results were the context the
 * model kept re-reading. Both are needed to make a run cheaper on purpose
 * rather than by guess (decision 141), so the fold keeps a ledger: one row per
 * thread, summed from the `usage` on that thread's `model.message` events,
 * and the largest tool results by byte size.
 *
 * Bytes, not tokens, for the tool results: the harness has no per-call token
 * count, and a result's size is what the next message's input carries. A
 * thread is named by its title and never by its id — the public plane serves
 * this and a thread id is withheld there (decision 34).
 *
 * Nothing here reads a clock, and everything is pure over the events, so a
 * rehydrated run computes exactly what the live one did.
 */

import type { ModelMessageUsage, ToolResponseEvent } from "@cujo/harness-contract";

/** How many tool results the ledger keeps. Enough to see the shape, not a transcript. */
const LARGEST_TOOL_RESULTS = 10;

export interface LedgerThread {
  /** `main` for the parent, the thread's title otherwise. Never a thread id. */
  title: string;
  /** 1 for the parent; a check's attempt number when the rubric respawned it. */
  attempt: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Absent until a message on this thread reports one (decision 54's rule). */
  reasoningTokens?: number;
  /** Bytes of every tool result this thread received. */
  toolResultBytes: number;
}

interface LedgerToolResult {
  /** The receiving thread's title, as on `LedgerThread`. */
  thread: string;
  tool: string;
  bytes: number;
  isError: boolean;
}

export interface RunLedger {
  threads: LedgerThread[];
  /** Largest first, at most `LARGEST_TOOL_RESULTS`. */
  largestToolResults: LedgerToolResult[];
}

export function emptyLedger(): RunLedger {
  return { threads: [], largestToolResults: [] };
}

/**
 * The row for a thread, created on first sight so the ledger's order is the
 * order threads appeared: the parent first, then each spawn. `byId` is the
 * fold's own map from thread id to row, kept out of the projection so no id
 * is ever stored beside a title.
 */
export function ledgerThread(
  ledger: RunLedger,
  byId: Map<string, LedgerThread>,
  threadId: string,
  title: string,
  attempt: number,
): LedgerThread {
  const found = byId.get(threadId);
  if (found) return found;
  const row: LedgerThread = {
    title,
    attempt,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolResultBytes: 0,
  };
  ledger.threads.push(row);
  byId.set(threadId, row);
  return row;
}

/** One model message's usage onto its thread's row. Mutates, like `addMessageUsage`. */
export function addLedgerMessage(row: LedgerThread, usage: ModelMessageUsage | undefined): void {
  row.messages += 1;
  if (!usage) return;
  row.inputTokens += usage.inputTokens ?? 0;
  row.outputTokens += usage.outputTokens ?? 0;
  row.cacheReadTokens += usage.cacheReadTokens ?? 0;
  row.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  if (usage.reasoningTokens !== undefined) {
    row.reasoningTokens = (row.reasoningTokens ?? 0) + usage.reasoningTokens;
  }
}

/**
 * One tool result onto its thread's row and, if it is among the largest seen,
 * into the run's list. The list stays sorted and bounded, so the insertion is
 * the whole cost.
 */
export function addToolResult(
  ledger: RunLedger,
  row: LedgerThread,
  event: Pick<ToolResponseEvent, "toolName" | "content" | "isError">,
): void {
  const bytes = Buffer.byteLength(event.content, "utf8");
  row.toolResultBytes += bytes;
  const entry: LedgerToolResult = {
    thread: row.title,
    tool: event.toolName,
    bytes,
    isError: event.isError,
  };
  const list = ledger.largestToolResults;
  if (list.length >= LARGEST_TOOL_RESULTS && bytes <= (list[list.length - 1]?.bytes ?? 0)) return;
  const at = list.findIndex((r) => r.bytes < bytes);
  list.splice(at === -1 ? list.length : at, 0, entry);
  if (list.length > LARGEST_TOOL_RESULTS) list.length = LARGEST_TOOL_RESULTS;
}
