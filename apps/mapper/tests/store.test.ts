import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@cujo/log";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskStore } from "../src/store";

const log = createLogger({ service: "mapper", sink: () => {} });
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cujo-mapper-disk-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A repository of `bytes`, last used `agoMs` ago. */
async function repo(key: string, bytes: number, agoMs: number): Promise<void> {
  const path = join(dir, key);
  await mkdir(join(path, "work"), { recursive: true });
  await writeFile(join(path, "work", "blob"), Buffer.alloc(bytes));
  const when = new Date(Date.now() - agoMs);
  const { utimes } = await import("node:fs/promises");
  await utimes(path, when, when);
}

describe("what leaves the volume to make room (decision 172)", () => {
  it("drops nothing while the volume is under its cap", async () => {
    await repo("a".repeat(32), 1000, 1000);
    const disk = new DiskStore({ dir, maxBytes: 1_000_000, log });
    expect(await disk.enforce("b".repeat(32))).toEqual([]);
  });

  it("drops the least recently used first, and never the one just written", async () => {
    const oldest = "a".repeat(32);
    const middle = "b".repeat(32);
    const newest = "c".repeat(32);
    await repo(oldest, 4000, 30_000);
    await repo(middle, 4000, 20_000);
    await repo(newest, 4000, 1_000);
    const disk = new DiskStore({ dir, maxBytes: 9000, log });
    expect(await disk.enforce(newest)).toEqual([oldest]);
    expect((await disk.list()).map((r) => r.key).sort()).toEqual([middle, newest].sort());
  });

  it("keeps the one just written even when it is the only thing over the cap", async () => {
    const keep = "a".repeat(32);
    await repo(keep, 9000, 1000);
    const disk = new DiskStore({ dir, maxBytes: 1000, log });
    // Everything evictable is gone and it is still over. Deleting what the
    // caller just asked for would answer the cap and lose the point.
    expect(await disk.enforce(keep)).toEqual([]);
    expect((await disk.list()).map((r) => r.key)).toEqual([keep]);
  });

  it("evicts a repository whole", async () => {
    const key = "a".repeat(32);
    await repo(key, 4000, 30_000);
    await repo("b".repeat(32), 4000, 1000);
    const disk = new DiskStore({ dir, maxBytes: 5000, log });
    await disk.enforce("b".repeat(32));
    // Not its worktree without its graph, nor the other way about: a graph
    // that describes files which are gone answers wrongly rather than not at
    // all.
    expect((await disk.list()).map((r) => r.key)).not.toContain(key);
  });

  it("reads an empty volume as empty rather than failing", async () => {
    const disk = new DiskStore({ dir: join(dir, "nothing-here"), maxBytes: 10, log });
    expect(await disk.list()).toEqual([]);
    expect(await disk.used()).toBe(0);
  });
});
