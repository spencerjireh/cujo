/**
 * What is on the volume, and what leaves it when the volume is full
 * (decision 172).
 *
 * One directory per key, holding that repository's worktree and the engine's
 * graph for it. Eviction is least-recently-used and whole: a repository is
 * either indexed or absent, never half of either, because a graph missing the
 * files it describes answers questions wrongly rather than not at all.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@cujo/log";

export interface DiskOptions {
  dir: string;
  /** The ceiling for everything below `dir`, in bytes. */
  maxBytes: number;
  log: Logger;
}

export interface RepoOnDisk {
  key: string;
  bytes: number;
  /** When this repository was last written or read, as the filesystem has it. */
  usedAt: number;
}

export class DiskStore {
  constructor(private readonly options: DiskOptions) {}

  /** Every repository on the volume, newest use first. */
  async list(): Promise<RepoOnDisk[]> {
    let names: string[];
    try {
      names = await readdir(this.options.dir);
    } catch {
      return [];
    }
    const repos: RepoOnDisk[] = [];
    for (const key of names) {
      const path = join(this.options.dir, key);
      try {
        const info = await stat(path);
        if (!info.isDirectory()) continue;
        repos.push({ key, bytes: await sizeOf(path), usedAt: info.mtimeMs });
      } catch {
        // Raced with an eviction; it is gone, which is what we wanted anyway.
      }
    }
    return repos.sort((a, b) => b.usedAt - a.usedAt);
  }

  async used(): Promise<number> {
    return (await this.list()).reduce((total, repo) => total + repo.bytes, 0);
  }

  /**
   * Evict whole repositories, least recently used first, until the volume is
   * under its cap. Never `keep`, which is the one being written: a caller
   * that just indexed a repository should not find it gone.
   *
   * Called after an index rather than before it, because what a repository
   * costs is not known until its graph exists — the tarballs are a poor
   * proxy and the worktree is only half of it. The cap is therefore a
   * high-water mark rather than a hard ceiling, which is the honest bound
   * for a directory whose size is discovered.
   */
  async enforce(keep: string): Promise<string[]> {
    let repos = await this.list();
    let total = repos.reduce((sum, repo) => sum + repo.bytes, 0);
    if (total <= this.options.maxBytes) return [];
    const dropped: string[] = [];
    // Oldest use first, and the one just written is not a candidate.
    repos = repos.filter((repo) => repo.key !== keep).reverse();
    for (const repo of repos) {
      if (total <= this.options.maxBytes) break;
      await rm(join(this.options.dir, repo.key), { recursive: true, force: true });
      total -= repo.bytes;
      dropped.push(repo.key);
      this.options.log.info("mapper.evicted", { reason: "disk", bytes: repo.bytes });
    }
    if (total > this.options.maxBytes) {
      // One repository is larger than the whole volume is allowed to be.
      // Everything evictable is gone and it is still over; say so rather
      // than delete the thing the caller just asked for.
      this.options.log.warn("mapper.disk.unfittable", {
        bytes: total,
        limit: this.options.maxBytes,
      });
    }
    return dropped;
  }

  async drop(key: string): Promise<void> {
    await rm(join(this.options.dir, key), { recursive: true, force: true });
  }
}

/** Bytes below a directory, following nothing and counting each file once. */
async function sizeOf(path: string): Promise<number> {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    let entries: string[];
    try {
      entries = await readdir(next);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = join(next, entry);
      try {
        const info = await stat(child);
        if (info.isDirectory()) stack.push(child);
        else total += info.size;
      } catch {
        // Vanished mid-walk; it contributes nothing.
      }
    }
  }
  return total;
}
