/**
 * The staging store (decision 158): a ticket buys one copy of two trees.
 */

import { mkdtemp, readFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createLogger } from "@cujo/log";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StagingError, StagingStore, isTicket, mintTicket } from "../src/stage";

const log = createLogger({ service: "sandbox-mcp", sink: () => {} });
let dir = "";
let store: StagingStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cujo-stage-"));
  store = new StagingStore({ dir, maxBytes: 64, ttlMs: 60_000, log });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const body = (text: string) => Readable.from([Buffer.from(text)]);

describe("tickets", () => {
  it("mints 32 hex characters and admits nothing else", () => {
    expect(isTicket(mintTicket())).toBe(true);
    expect(isTicket("../etc")).toBe(false);
    expect(isTicket("ABCDEF0123456789ABCDEF0123456789")).toBe(false);
  });
});

describe("put", () => {
  it("stores a tree under its ticket and counts the bytes", async () => {
    const ticket = mintTicket();
    await expect(store.put(ticket, "base", body("tar bytes"))).resolves.toEqual({ bytes: 9 });
    expect(await readFile(join(dir, ticket, "base.tgz"), "utf8")).toBe("tar bytes");
  });

  it("refuses a ticket that is not one, before touching the disk", async () => {
    await expect(store.put("../x", "base", body("x"))).rejects.toMatchObject({
      kind: "bad_ticket",
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a tree name it does not know", async () => {
    await expect(store.put(mintTicket(), "tail", body("x"))).rejects.toMatchObject({
      kind: "bad_tree",
    });
  });

  it("stops at the cap and leaves no partial file", async () => {
    const ticket = mintTicket();
    const big = Readable.from([Buffer.alloc(40), Buffer.alloc(40)]);
    await expect(store.put(ticket, "head", big)).rejects.toMatchObject({ kind: "too_large" });
    expect(await readdir(join(dir, ticket))).toEqual([]);
  });

  it("refuses a second body for a tree already staged", async () => {
    const ticket = mintTicket();
    await store.put(ticket, "head", body("one"));
    await expect(store.put(ticket, "head", body("two"))).rejects.toBeInstanceOf(StagingError);
    expect(await readFile(join(dir, ticket, "head.tgz"), "utf8")).toBe("one");
  });
});

describe("take", () => {
  it("hands both trees over once, then the ticket is spent", async () => {
    const ticket = mintTicket();
    await store.put(ticket, "base", body("b"));
    await store.put(ticket, "head", body("h"));
    const taken = await store.take(ticket);
    expect(taken).not.toBeNull();
    expect(await readFile(taken?.trees.base ?? "", "utf8")).toBe("b");
    expect(await readFile(taken?.trees.head ?? "", "utf8")).toBe("h");
    expect(await store.take(ticket)).toBeNull();
    await taken?.release();
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers null for a ticket with one tree, and removes it", async () => {
    const ticket = mintTicket();
    await store.put(ticket, "base", body("b"));
    expect(await store.take(ticket)).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers null for a ticket nobody staged, or one that is not a ticket", async () => {
    expect(await store.take(mintTicket())).toBeNull();
    expect(await store.take("nope")).toBeNull();
  });
});

describe("sweep", () => {
  it("removes entries older than the ttl and keeps the rest", async () => {
    const old = mintTicket();
    const young = mintTicket();
    await store.put(old, "base", body("b"));
    await store.put(young, "base", body("b"));
    const past = new Date(Date.now() - 120_000);
    await utimes(join(dir, old), past, past);
    expect(await store.sweep()).toBe(1);
    expect(await readdir(dir)).toEqual([young]);
  });
});
