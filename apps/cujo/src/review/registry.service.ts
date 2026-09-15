/**
 * Keeps the repository registry honest (decision 151).
 *
 * The `installation` and `installation_repositories` webhooks are the fast
 * path. This is the reconciler behind them, for the cases a delivery cannot
 * cover: one that never arrived, an App installed before the table existed,
 * and the first boot of a deploy, where the table is empty until something
 * asks GitHub.
 *
 * `.service.ts` because it holds a timer across requests, per decision 32.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import { normalizeRepo } from "../store/db";
import type { RepositoryStore } from "../store/repositories";

export interface RegistryDeps {
  log: Logger;
  repositories: Pick<RepositoryStore, "upsertInstalled" | "markRemoved" | "listActive">;
  github: Pick<GitHubReader, "listInstalledRepos">;
  /** Milliseconds between syncs. 0 turns the sync off entirely. */
  intervalMs: number;
  now?: () => Date;
}

export class RegistryService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: RegistryDeps) {}

  /**
   * One pass: what GitHub lists is upserted, what it no longer lists is marked
   * removed. Sequential inside the client, so a large App cannot burst the
   * rate limit; there is no deadline to beat.
   */
  async sync(): Promise<{ seen: number; removed: number }> {
    const at = (this.deps.now ?? (() => new Date()))().toISOString();
    const { repos: listed, complete } = await this.deps.github.listInstalledRepos();
    this.deps.repositories.upsertInstalled(listed, at);
    const keep = new Set(listed.map((entry) => normalizeRepo(entry.repo)));
    // A listing the page cap cut short is not evidence of absence: what it
    // did list is upserted, and nothing is removed until a complete pass.
    const gone = complete
      ? this.deps.repositories
          .listActive()
          .map((row) => row.repo)
          .filter((repo) => !keep.has(repo))
      : [];
    const removed = gone.length ? this.deps.repositories.markRemoved(gone, at) : [];
    for (const repo of removed) this.deps.log.info("registry.removed", { repo, reason: "sync" });
    // One line per sync, which is one line every few hours: `count` is what
    // GitHub listed, `active` the distinct repositories now held.
    this.deps.log.info("registry.synced", { count: listed.length, active: keep.size });
    return { seen: listed.length, removed: removed.length };
  }

  /** Syncs once now, then on the interval. The immediate pass fills a fresh table. */
  start(): void {
    if (this.deps.intervalMs <= 0 || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Skips rather than overlaps: a slow sync must not stack on the next tick. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync();
    } catch (error) {
      // A reconciler that dies on one bad pass stops reconciling.
      this.deps.log.error("registry.sync.failed", errorFields(error));
    } finally {
      this.running = false;
    }
  }
}
