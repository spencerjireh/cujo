import type { RunSummary } from "@/lib/api/types";

/**
 * Which run is the current one for each pull request.
 *
 * A pull request that was pushed to twice is two runs on the record, and the
 * record used to draw them as two unrelated rows. They are not unrelated: the
 * later head replaced the earlier one, and any review the earlier run posted
 * was dismissed by the push. The API does not say this — a run row carries no
 * "superseded by" field, and the public plane is read-only and adds nothing
 * to serve one page (decision 57) — so it is derived here from what the row
 * already carries: `repo`, `pr_number` and `created_at`.
 *
 * Derived on the client, this is a claim about the runs *on this board* and
 * not about the pull request. A run older than the list's window is invisible
 * to it, which is the right blindness: the record shows what it shows.
 *
 * Keyed by run id so a renderer can ask about one row without knowing the
 * others. The key for a pull request is `repo#number`; `#` cannot appear in a
 * repository name.
 */
export function latestByPullRequest(runs: readonly RunSummary[]): Set<string> {
  const newest = new Map<string, RunSummary>();
  for (const run of runs) {
    const key = pullRequestKey(run);
    const held = newest.get(key);
    if (!held || run.created_at > held.created_at) newest.set(key, run);
  }
  return new Set(Array.from(newest.values(), (run) => run.id));
}

/** How many distinct pull requests the runs cover. */
export function pullRequestKey(run: Pick<RunSummary, "repo" | "pr_number">): string {
  return `${run.repo}#${run.pr_number}`;
}

/**
 * Whether more than one run on the board belongs to this run's pull request,
 * which is the only case where "latest" says anything: a chip on every row of
 * a record where nothing was ever re-pushed is noise.
 */
export function hasSiblings(run: RunSummary, runs: readonly RunSummary[]): boolean {
  const key = pullRequestKey(run);
  let seen = 0;
  for (const other of runs) {
    if (pullRequestKey(other) === key) seen += 1;
    if (seen > 1) return true;
  }
  return false;
}
