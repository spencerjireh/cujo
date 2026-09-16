/**
 * Staged trees for a private repository (decision 158).
 *
 * `apps/cujo` fetches the base and head archives of a private pull request on
 * the trusted side, with the installation token, and puts them here under a
 * ticket it minted; `sandbox_create` with that ticket copies both into the box
 * it makes and the entry is gone. The ticket is the whole handle: it buys
 * "copy these two trees into a sandbox", once, for a short while, and it is
 * not a credential — nothing that holds it can read the trees back out.
 *
 * Files rather than memory because a tree can be hundreds of megabytes and a
 * process holding two of them per run would fall over on the third. The
 * directory is this service's own tmpfs in the deployment, so a staged tree
 * never touches the host's disk.
 */

import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type Logger, createLogger } from "@cujo/log";

/** The two trees a review needs, and the only two names a caller may use. */
const TREES = ["base", "head"] as const;
export type Tree = (typeof TREES)[number];

/** 32 hex characters, which is what `apps/cujo` mints. Anything else is refused. */
const TICKET = /^[0-9a-f]{32}$/;

export function isTicket(value: string): boolean {
  return TICKET.test(value);
}

function isTree(value: string): value is Tree {
  return (TREES as readonly string[]).includes(value);
}

export function mintTicket(): string {
  return randomBytes(16).toString("hex");
}

export interface StagingOptions {
  /** Where the archives rest until a sandbox takes them. */
  dir: string;
  /** Bytes per tree. Over it the put fails and the partial file is removed. */
  maxBytes: number;
  /** How long an entry nobody took survives. */
  ttlMs: number;
  log?: Logger;
  now?: () => number;
}

export class StagingError extends Error {
  constructor(
    readonly kind: "bad_ticket" | "bad_tree" | "too_large" | "exists" | "missing",
    message: string,
  ) {
    super(message);
    this.name = "StagingError";
  }
}

/** Both archives of one ticket, as paths this process may read. */
export interface StagedTrees {
  base: string;
  head: string;
}

export class StagingStore {
  private readonly log: Logger;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: StagingOptions) {
    this.log = options.log ?? createLogger({ service: "sandbox-mcp" });
    this.now = options.now ?? Date.now;
  }

  private file(ticket: string, tree: Tree): string {
    return join(this.options.dir, ticket, `${tree}.tgz`);
  }

  /**
   * Store one tree's archive. The body is written as it arrives and counted
   * as it is written; past the cap the write stops, the file goes, and the
   * caller hears `too_large`. A tree already staged under the ticket is
   * `exists`: a put is not a retry, since the first body may be the whole
   * tree and the second only half of one.
   */
  async put(ticket: string, tree: string, body: Readable): Promise<{ bytes: number }> {
    if (!isTicket(ticket)) throw new StagingError("bad_ticket", "ticket is not 32 hex characters");
    if (!isTree(tree)) throw new StagingError("bad_tree", "tree must be base or head");
    const path = this.file(ticket, tree);
    await mkdir(join(this.options.dir, ticket), { recursive: true });
    if (await exists(path)) throw new StagingError("exists", `${tree} is already staged`);
    let bytes = 0;
    const cap = this.options.maxBytes;
    const counted = async function* (source: Readable) {
      for await (const chunk of source) {
        bytes += (chunk as Buffer).length;
        if (bytes > cap) throw new StagingError("too_large", `${tree} is over ${cap} bytes`);
        yield chunk;
      }
    };
    try {
      await pipeline(body, counted, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    this.log.info("stage.received", { path: tree, bytes });
    return { bytes };
  }

  /**
   * Take both trees of a ticket. Single use: the entry is renamed away at
   * once, so a second call with the same ticket — a retried tool call, a
   * ticket read out of a transcript — finds nothing. The caller deletes the
   * paths through `release` when the copy is done, success or not.
   */
  async take(ticket: string): Promise<{ trees: StagedTrees; release: () => Promise<void> } | null> {
    if (!isTicket(ticket)) return null;
    const dir = join(this.options.dir, ticket);
    const taken = `${dir}.taken`;
    try {
      await rename(dir, taken);
    } catch {
      return null;
    }
    const trees = { base: join(taken, "base.tgz"), head: join(taken, "head.tgz") };
    const release = async () => {
      await rm(taken, { recursive: true, force: true });
    };
    if (!(await exists(trees.base)) || !(await exists(trees.head))) {
      await release();
      this.log.warn("stage.refused", { reason: "incomplete" });
      return null;
    }
    this.log.info("stage.consumed", {});
    return { trees, release };
  }

  /** Remove every entry older than the TTL, taken or not. */
  async sweep(): Promise<number> {
    let removed = 0;
    let names: string[];
    try {
      names = await readdir(this.options.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      const path = join(this.options.dir, name);
      try {
        const info = await stat(path);
        if (this.now() - info.mtimeMs < this.options.ttlMs) continue;
        await rm(path, { recursive: true, force: true });
        removed += 1;
      } catch {
        // Gone between the listing and the stat: somebody took it.
      }
    }
    if (removed > 0) this.log.info("stage.expired", { count: removed });
    return removed;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
