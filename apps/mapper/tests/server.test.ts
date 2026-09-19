import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@cujo/log";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/engine";
import { TreeStore } from "../src/ingest";
import { createApp } from "../src/server";
import { DiskStore } from "../src/store";

const log = createLogger({ service: "mapper", sink: () => {} });
const KEY = "a".repeat(32);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cujo-mapper-http-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function engineThat(answer: Record<string, unknown>): Engine {
  return { run: async () => answer } as unknown as Engine;
}

/** Start the app on an ephemeral port and answer with a caller for it. */
async function serve(options: { mcp?: boolean; engine?: Engine; ready?: Promise<void> } = {}) {
  const app = createApp({
    engine: options.engine ?? engineThat({}),
    trees: new TreeStore({ dir, maxBytes: 1024, log }),
    disk: new DiskStore({ dir, maxBytes: 1024 * 1024, log }),
    dir,
    log,
    ...(options.ready ? { ready: options.ready } : {}),
    ...(options.mcp
      ? {
          mcp: async (_req: unknown, res: ServerResponse) => {
            res.end("{}");
          },
        }
      : {}),
  });
  await new Promise<void>((resolve) => app.listen(0, resolve));
  const { port } = app.address() as AddressInfo;
  return {
    call: (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init),
    close: () => new Promise<void>((resolve) => app.close(() => resolve())),
  };
}

describe("the mapper's doors", () => {
  it("is healthy and names itself", async () => {
    const s = await serve();
    const res = await s.call("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "mapper" });
    await s.close();
  });

  it("answers nothing but liveness until the engine has been seen to run", async () => {
    // A bundle that loads proves nothing about a C binary beside it: the
    // image once shipped an engine built against a newer glibc than the
    // runtime had, and every check passed until the first index.
    let admit = (): void => {};
    const s = await serve({
      ready: new Promise<void>((resolve) => {
        admit = resolve;
      }),
    });
    expect((await s.call("/healthz")).status).toBe(200);
    expect((await s.call("/readyz")).status).toBe(503);
    expect((await s.call("/slice", { method: "POST", body: "{}" })).status).toBe(503);
    admit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await s.call("/readyz")).status).toBe(200);
    expect((await s.call("/slice", { method: "POST", body: "{}" })).status).toBe(400);
    await s.close();
  });

  it("takes a tree on PUT and refuses any other method", async () => {
    const s = await serve();
    const put = await s.call(`/ingest/${KEY}/base`, { method: "PUT", body: "xx" });
    expect(put.status).toBe(201);
    const get = await s.call(`/ingest/${KEY}/head`);
    expect(get.status).toBe(405);
    await s.close();
  });

  it("answers 413 for a tree over the cap and 400 for a tree that is not one", async () => {
    const s = await serve();
    const big = await s.call(`/ingest/${KEY}/base`, {
      method: "PUT",
      body: "x".repeat(4096),
    });
    expect(big.status).toBe(413);
    const named = await s.call(`/ingest/${KEY}/sideways`, { method: "PUT", body: "x" });
    expect(named.status).toBe(400);
    await s.close();
  });

  it("refuses to index a key that is not one", async () => {
    const s = await serve();
    const res = await s.call("/ingest/not-a-key/index", { method: "POST" });
    expect(res.status).toBe(400);
    await s.close();
  });

  it("answers 404 when a key was never fully staged", async () => {
    const s = await serve();
    await s.call(`/ingest/${KEY}/base`, { method: "PUT", body: "x" });
    const res = await s.call(`/ingest/${KEY}/index`, { method: "POST" });
    expect(res.status).toBe(404);
    await s.close();
  });

  it("wants a project and a base before it will build a slice", async () => {
    const s = await serve();
    const empty = await s.call("/slice", { method: "POST", body: "{}" });
    expect(empty.status).toBe(400);
    const notJson = await s.call("/slice", { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    await s.close();
  });

  it("builds a slice from what the engine says", async () => {
    const s = await serve({
      engine: engineThat({
        changed_files: ["a.ts"],
        impacted: [{ qn: "one", label: "Function", file: "a.ts", hop: 1 }],
        impacted_total: 1,
        impacted_has_more: false,
      }),
    });
    const res = await s.call("/slice", {
      method: "POST",
      body: JSON.stringify({ project: "p", base: "abc" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      changed_files: ["a.ts"],
      impacted: [{ qn: "one", hop: 1 }],
      truncated: false,
    });
    await s.close();
  });

  it("has no MCP endpoint unless a composition mounts one", async () => {
    const off = await serve();
    expect((await off.call("/mcp", { method: "POST", body: "{}" })).status).toBe(404);
    await off.close();
    const on = await serve({ mcp: true });
    expect((await on.call("/mcp", { method: "POST", body: "{}" })).status).toBe(200);
    await on.close();
  });
});
