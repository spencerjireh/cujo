import type { Run, RunList } from "./types";

/**
 * Pure reducers for the run stream, kept out of the hook so they can be tested
 * without a DOM. The stream sends a full snapshot per event and is explicitly
 * allowed to repeat one, so both reducers return the previous object by
 * reference when nothing meaningful changed — that is what stops a duplicate
 * from re-rendering the tree.
 */

export function parseSnapshot(data: string): Run | null {
  try {
    const value = JSON.parse(data) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const run = value as Partial<Run>;
    return typeof run.id === "string" && typeof run.status === "string" ? (run as Run) : null;
  } catch {
    return null;
  }
}

export function reduceRun(previous: Run | undefined, snapshot: Run): Run {
  if (
    previous &&
    previous.updated_at === snapshot.updated_at &&
    previous.status === snapshot.status
  ) {
    return previous;
  }
  return snapshot;
}

/**
 * Patch the list row in place rather than invalidating it, so watching one run
 * does not trigger a list refetch per event. The list's own poll corrects any
 * drift, and a run the list has not seen yet is left for that poll to add.
 */
export function reduceList(previous: RunList | undefined, snapshot: Run): RunList | undefined {
  if (!previous) return previous;
  const index = previous.runs.findIndex((run) => run.id === snapshot.id);
  if (index === -1) return previous;
  const row = previous.runs[index];
  if (!row) return previous;
  if (row.status === snapshot.status && row.updated_at === snapshot.updated_at) {
    return previous;
  }
  const runs = previous.runs.slice();
  runs[index] = {
    ...row,
    status: snapshot.status,
    updated_at: snapshot.updated_at,
  };
  return { runs };
}
