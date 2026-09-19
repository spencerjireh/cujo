/**
 * The two-tree door, and the git repository this service builds from it
 * (decision 172).
 *
 * The staging half is `sandbox-mcp`'s (decision 158), for the same reasons
 * and in the same shape: a ticket, one streamed gzipped tarball per tree,
 * bounded as it is written rather than buffered and checked afterwards.
 *
 * The other half is why there are two trees rather than one. `detect_changes`
 * — the tool this whole service exists to reach — takes a git ref and reports
 * a merge base; the engine compiles git-history and git-diff passes. A
 * `github.archive` tarball carries no `.git` at all, so a tree ingested on its
 * own would lose the most valuable thing the engine does.
 *
 * So the base tree is extracted and committed, the head tree replaces the
 * working tree and is committed on top, and the engine is handed a repository
 * with a real history two commits deep. The bytes are ones `apps/cujo`
 * already fetches for the sandbox; no network and no credential is involved
 * in making them a repository.
 */

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { Logger } from "@cujo/log";

const run = promisify(execFile);

/** The two trees, and nothing else may be named. */
const TREES = ["base", "head"] as const;
export type Tree = (typeof TREES)[number];

/** A key is a repository's identity, hashed by the caller; never a repo name. */
const KEY = /^[0-9a-f]{32}$/;

export function isKey(value: string): boolean {
  return KEY.test(value);
}

export function isTree(value: string): value is Tree {
  return (TREES as readonly string[]).includes(value);
}

export class IngestError extends Error {
  constructor(
    readonly kind: "bad_key" | "bad_tree" | "too_large" | "exists" | "missing" | "corrupt",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface IngestOptions {
  /** The volume. One directory per key, holding its tarballs and its worktree. */
  dir: string;
  /** Bound on one tree's bytes, applied as they arrive. */
  maxBytes: number;
  log: Logger;
}

/** Where a key's work lives, so the store and the router agree on one layout. */
export function repoPath(dir: string, key: string): string {
  return join(dir, key, "work");
}

export class TreeStore {
  constructor(private readonly options: IngestOptions) {}

  private file(key: string, tree: Tree): string {
    return join(this.options.dir, key, `${tree}.tgz`);
  }

  /** Stream one tree in. Bounded as it is written; a refusal leaves nothing. */
  async put(key: string, tree: string, body: Readable): Promise<{ bytes: number }> {
    if (!isKey(key)) throw new IngestError("bad_key", "key is not 32 hex characters");
    if (!isTree(tree)) throw new IngestError("bad_tree", "tree must be base or head");
    const path = this.file(key, tree);
    await mkdir(join(this.options.dir, key), { recursive: true });
    if (await exists(path)) throw new IngestError("exists", `${tree} is already staged`);
    let bytes = 0;
    const cap = this.options.maxBytes;
    const counted = async function* (source: Readable) {
      for await (const chunk of source) {
        bytes += (chunk as Buffer).length;
        if (bytes > cap) throw new IngestError("too_large", `${tree} is over ${cap} bytes`);
        yield chunk;
      }
    };
    try {
      await pipeline(body, counted, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    this.options.log.info("ingest.received", { path: tree, bytes });
    return { bytes };
  }

  /**
   * Turn the two staged tarballs into a repository with a history.
   *
   * Commits are stamped with a fixed identity and a fixed date so the same
   * two trees always produce the same two commit ids — a property worth
   * having the day someone asks why a slice changed.
   */
  async materialise(key: string): Promise<{ path: string; base: string; head: string }> {
    if (!isKey(key)) throw new IngestError("bad_key", "key is not 32 hex characters");
    for (const tree of TREES) {
      if (!(await exists(this.file(key, tree)))) {
        throw new IngestError("missing", `${tree} was never staged`);
      }
    }
    const path = repoPath(this.options.dir, key);
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });

    await this.git(path, ["init", "--quiet", "--initial-branch", "main"]);
    await this.extract(key, "base", path);
    const base = await this.commitTree(path, "base");
    // The head tree replaces the working tree rather than merging into it, so
    // a file the pull request deletes is deleted here too and the diff the
    // engine reads is the diff GitHub would show.
    await this.clear(path);
    await this.extract(key, "head", path);
    const head = await this.commitTree(path, "head");
    this.options.log.info("ingest.materialised", { head_sha: head, count: 2 });
    return { path, base, head };
  }

  /** Stage everything, commit it, and answer with the commit id. */
  private async commitTree(path: string, message: string): Promise<string> {
    await this.git(path, ["add", "--all"]);
    await this.git(path, ["commit", "--quiet", "--allow-empty", "--message", message]);
    const { stdout } = await this.git(path, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  /**
   * Git with a fixed identity and a fixed clock. Two identical trees then
   * produce two identical commit ids, which makes a slice reproducible and a
   * difference between two runs a real difference rather than a timestamp.
   */
  private git(path: string, argv: readonly string[]): Promise<{ stdout: string }> {
    return run("git", ["-C", path, ...GIT_IDENTITY, ...argv], {
      env: { ...process.env, ...GIT_CLOCK },
    });
  }

  private async extract(key: string, tree: Tree, into: string): Promise<void> {
    try {
      // GitHub's archive wraps everything in one directory named for the
      // commit, which is not part of any path the review will talk about.
      await run("tar", ["-xzf", this.file(key, tree), "-C", into, "--strip-components=1"]);
    } catch (error) {
      throw new IngestError("corrupt", `${tree} is not a readable gzipped tar: ${String(error)}`);
    }
  }

  /** Everything but `.git`, so the next tree lands on a clean worktree. */
  private async clear(path: string): Promise<void> {
    await run("sh", [
      "-c",
      'find "$1" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +',
      "sh",
      path,
    ]);
  }

  /** Remove a key's tarballs once its repository exists; the graph is the point. */
  async dropArchives(key: string): Promise<void> {
    for (const tree of TREES) await rm(this.file(key, tree), { force: true });
  }
}

/** Never the machine's git config, and never a signing key it does not have. */
const GIT_IDENTITY = [
  "-c",
  "user.name=cujo",
  "-c",
  "user.email=cujo@invalid",
  "-c",
  "commit.gpgsign=false",
];

/** The fixed clock half of the same property. */
const GIT_CLOCK = {
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
