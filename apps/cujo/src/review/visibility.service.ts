/**
 * Keeps each run's `is_public` stamp honest (decision 34).
 *
 * The `repository` webhook is the fast path and carries a flip in seconds. This
 * is the reconciler behind it, and it exists for three cases the webhook cannot
 * cover: a delivery that never arrived, a repo renamed out from under its stamp,
 * and — the one that matters on the first deploy — the rows written before the
 * column existed, which answer nothing and are therefore invisible until
 * something asks GitHub about them.
 *
 * `.service.ts` because it holds a timer across requests, per decision 32.
 */

import type { GitHubReader } from "../clients/github";
import type { RunStore } from "../store";

export interface VisibilityDeps {
  runs: RunStore;
  github: GitHubReader;
  /** Milliseconds between sweeps. 0 turns the sweep off entirely. */
  intervalMs: number;
}

export class VisibilityService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: VisibilityDeps) {}

  /**
   * One pass over every repo that has a run. Sequential on purpose: a parallel
   * burst is the one thing here that could exhaust the App's rate limit, and
   * there is no deadline to beat — the webhook already handled the urgent case.
   */
  async sweep(): Promise<{ checked: number; changed: number; unknown: number }> {
    let changed = 0;
    let unknown = 0;
    const repos = this.deps.runs.listRunRepos();
    for (const repo of repos) {
      const answer = await this.deps.github.repoIsPublic(repo);
      if (answer === "unknown") {
        unknown += 1;
        continue;
      }
      changed += this.deps.runs.setRepoVisibility(repo, answer === "public");
    }
    if (changed || unknown) {
      console.log(
        `visibility sweep: ${repos.length} repos, ${changed} runs re-stamped, ${unknown} unanswered`,
      );
    }
    return { checked: repos.length, changed, unknown };
  }

  /**
   * Sweeps once now, then on the interval. The immediate pass is not just
   * eagerness: it is what backfills the rows that predate the column, without
   * which the board launches empty.
   */
  start(): void {
    if (this.deps.intervalMs <= 0 || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs);
    // Never hold the process open for a sweep.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Skips rather than overlaps: a slow sweep must not stack on the next tick. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      // A reconciler that dies on one bad pass stops reconciling.
      console.error("visibility sweep failed", error);
    } finally {
      this.running = false;
    }
  }
}
