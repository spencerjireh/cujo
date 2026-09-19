import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { createLogger } from "@cujo/log";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IngestError, TreeStore, isKey, isTree } from "../src/ingest";

const run = promisify(execFile);
const log = createLogger({ service: "mapper", sink: () => {} });
const KEY = "a".repeat(32);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cujo-mapper-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A gzipped tar shaped like GitHub's: everything under one wrapper directory. */
async function archive(files: Record<string, string>): Promise<Buffer> {
  const staging = join(dir, `src-${Math.random().toString(16).slice(2)}`);
  const root = join(staging, "repo-abc1234");
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text);
  }
  const out = join(staging, "out.tgz");
  await run("tar", ["-czf", out, "-C", staging, "repo-abc1234"]);
  return readFile(out);
}

describe("the two-tree door", () => {
  it("refuses a key that is not 32 hex characters, and a tree that is not base or head", async () => {
    expect(isKey("nope")).toBe(false);
    expect(isKey(KEY)).toBe(true);
    expect(isTree("head")).toBe(true);
    expect(isTree("HEAD")).toBe(false);
    const store = new TreeStore({ dir, maxBytes: 1024, log });
    await expect(store.put("nope", "base", Readable.from(["x"]))).rejects.toThrow(IngestError);
    await expect(store.put(KEY, "other", Readable.from(["x"]))).rejects.toThrow(IngestError);
  });

  it("bounds a tree as it arrives and leaves nothing behind when it is too large", async () => {
    const store = new TreeStore({ dir, maxBytes: 8, log });
    await expect(store.put(KEY, "base", Readable.from([Buffer.alloc(64)]))).rejects.toMatchObject({
      kind: "too_large",
    });
    // The refused write is gone, so a retry is a fresh one rather than a 409.
    await expect(store.put(KEY, "base", Readable.from([Buffer.alloc(4)]))).resolves.toEqual({
      bytes: 4,
    });
  });

  it("refuses a second write of the same tree", async () => {
    const store = new TreeStore({ dir, maxBytes: 1024, log });
    await store.put(KEY, "base", Readable.from([Buffer.alloc(4)]));
    await expect(store.put(KEY, "base", Readable.from([Buffer.alloc(4)]))).rejects.toMatchObject({
      kind: "exists",
    });
  });

  it("will not materialise a key that was never fully staged", async () => {
    const store = new TreeStore({ dir, maxBytes: 1024, log });
    await store.put(KEY, "base", Readable.from([Buffer.alloc(4)]));
    await expect(store.materialise(KEY)).rejects.toMatchObject({ kind: "missing" });
  });
});

describe("the repository the two trees become (decision 172)", () => {
  it("has base then head, and the head tree is what the worktree holds", async () => {
    const store = new TreeStore({ dir, maxBytes: 1024 * 1024, log });
    await store.put(
      KEY,
      "base",
      Readable.from([await archive({ "a.ts": "export const a = 1;\n" })]),
    );
    await store.put(
      KEY,
      "head",
      Readable.from([
        await archive({ "a.ts": "export const a = 2;\n", "b.ts": "export const b = 1;\n" }),
      ]),
    );
    const { path, base, head } = await store.materialise(KEY);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(base).not.toBe(head);

    const { stdout: log2 } = await run("git", ["-C", path, "log", "--format=%s", "--reverse"]);
    expect(log2.trim().split("\n")).toEqual(["base", "head"]);

    // The wrapper directory GitHub adds is not part of any path.
    expect(await readFile(join(path, "a.ts"), "utf8")).toBe("export const a = 2;\n");

    // And the diff between the two commits is the pull request's own.
    const { stdout: diff } = await run("git", [
      "-C",
      path,
      "diff",
      "--name-status",
      `${base}..${head}`,
    ]);
    expect(diff.trim().split("\n").sort()).toEqual(["A\tb.ts", "M\ta.ts"]);
  });

  it("deletes on the head side what the pull request deleted", async () => {
    const store = new TreeStore({ dir, maxBytes: 1024 * 1024, log });
    await store.put(
      KEY,
      "base",
      Readable.from([await archive({ "keep.ts": "1\n", "gone.ts": "2\n" })]),
    );
    await store.put(KEY, "head", Readable.from([await archive({ "keep.ts": "1\n" })]));
    const { path, base, head } = await store.materialise(KEY);
    const { stdout } = await run("git", ["-C", path, "diff", "--name-status", `${base}..${head}`]);
    // A tree merged over the old one would have missed this entirely.
    expect(stdout.trim()).toBe("D\tgone.ts");
  });

  it("gives the same two commit ids for the same two trees", async () => {
    const store = new TreeStore({ dir, maxBytes: 1024 * 1024, log });
    const base = await archive({ "a.ts": "1\n" });
    const head = await archive({ "a.ts": "2\n" });
    await store.put(KEY, "base", Readable.from([base]));
    await store.put(KEY, "head", Readable.from([head]));
    const first = await store.materialise(KEY);
    const second = await store.materialise(KEY);
    // A fixed identity and a fixed clock, so a slice that changes means the
    // code changed and not the wall clock.
    expect(second.base).toBe(first.base);
    expect(second.head).toBe(first.head);
  });
});
