/**
 * Staging a private repository's trees (decision 158): base, then head,
 * under one ticket, and nothing else.
 */
import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { mintTicket, stageTrees } from "../../src/review/stage";

function harness(over: { failOn?: "base" | "head" } = {}) {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
  const fetched: string[] = [];
  const puts: { ticket: string; tree: string; body: unknown }[] = [];
  const github = {
    archive: vi.fn(async (_repo: string, sha: string) => {
      fetched.push(sha);
      return sha as unknown as ReadableStream<Uint8Array>;
    }),
  };
  const stager = {
    put: vi.fn(async (ticket: string, tree: "base" | "head", body: ReadableStream) => {
      if (over.failOn === tree) throw new Error(`staging the ${tree} tree failed: full`);
      puts.push({ ticket, tree, body });
      return tree === "base" ? 100 : 20;
    }),
  };
  return { deps: { github, stager, log }, lines, fetched, puts };
}

describe("stageTrees", () => {
  it("fetches base then head and stages both under one fresh ticket", async () => {
    const h = harness();
    const ticket = await stageTrees(h.deps, { repo: "o/r", baseSha: "b", headSha: "h" });
    expect(ticket).toMatch(/^[0-9a-f]{32}$/);
    expect(h.fetched).toEqual(["b", "h"]);
    expect(h.puts.map((p) => [p.ticket, p.tree, p.body])).toEqual([
      [ticket, "base", "b"],
      [ticket, "head", "h"],
    ]);
    expect(h.lines.find((l) => l.event === "run.staged")).toMatchObject({ bytes: 120 });
  });

  it("stops at the first failure and fetches nothing more", async () => {
    const h = harness({ failOn: "base" });
    await expect(stageTrees(h.deps, { repo: "o/r", baseSha: "b", headSha: "h" })).rejects.toThrow(
      "staging the base tree failed",
    );
    expect(h.fetched).toEqual(["b"]);
    expect(h.lines.find((l) => l.event === "run.staged")).toBeUndefined();
  });

  it("mints a different ticket every time", () => {
    expect(mintTicket()).not.toBe(mintTicket());
  });
});
