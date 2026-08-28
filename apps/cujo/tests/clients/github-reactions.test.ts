import { describe, expect, it, vi } from "vitest";

vi.mock("@cujo/gh-app-auth", () => ({
  normalisePrivateKey: (pem: string) => pem,
  getInstallationIdForRepo: vi.fn(async () => 42),
  getInstallationToken: vi.fn(async () => "ghs_token"),
  getAppJwt: vi.fn(async () => "app_jwt"),
}));

import { BOT_LOGIN } from "../../src/clients/github";
import { GitHubReactions } from "../../src/clients/github-reactions";

interface Row {
  id: number;
  content: string;
  login: string;
}

/**
 * A GitHub that behaves the way the live API was observed to: the POST is
 * idempotent (200 when the reaction already stands, 201 when it is new), the
 * list names the author of each reaction, and the DELETE is by id.
 */
function server(initial: Row[] = []) {
  const rows = [...initial];
  const log: string[] = [];
  let nextId = 100;
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    log.push(`${method} ${url.pathname}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghs_token");
    if (method === "POST") {
      const { content } = JSON.parse(String(init?.body)) as { content: string };
      const standing = rows.find((r) => r.login === BOT_LOGIN && r.content === content);
      if (standing) return new Response(JSON.stringify(standing), { status: 200 });
      const row = { id: nextId++, content, login: BOT_LOGIN };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 201 });
    }
    if (method === "DELETE") {
      const id = Number(url.pathname.split("/").pop());
      const at = rows.findIndex((r) => r.id === id);
      if (at === -1) return new Response(null, { status: 404 });
      rows.splice(at, 1);
      return new Response(null, { status: 204 });
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    const body = rows
      .slice((page - 1) * 100, page * 100)
      .map((r) => ({ id: r.id, content: r.content, user: { login: r.login } }));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, rows, log };
}

const ours = (content: string, id: number): Row => ({ id, content, login: BOT_LOGIN });

describe("GitHubReactions.set", () => {
  it("leaves the bot wearing exactly what was asked for", async () => {
    const { impl, rows } = server([ours("eyes", 1), ours("rocket", 2)]);
    await new GitHubReactions("1", "pem", impl).set("o/r", 7, ["hooray"]);
    expect(rows).toEqual([{ id: 100, content: "hooray", login: BOT_LOGIN }]);
  });

  it("never touches anyone else's reaction", async () => {
    const theirs = { id: 5, content: "+1", login: "someone" };
    const { impl, rows } = server([theirs, ours("eyes", 1)]);
    await new GitHubReactions("1", "pem", impl).set("o/r", 7, ["confused"]);
    expect(rows).toContainEqual(theirs);
    expect(rows.filter((r) => r.login === BOT_LOGIN)).toEqual([
      { id: 100, content: "confused", login: BOT_LOGIN },
    ]);
  });

  it("re-posts a standing reaction rather than deleting it, so the pull request never flickers", async () => {
    const { impl, rows, log } = server([ours("eyes", 1)]);
    await new GitHubReactions("1", "pem", impl).set("o/r", 7, ["eyes"]);
    expect(rows).toEqual([ours("eyes", 1)]);
    expect(log.some((line) => line.startsWith("DELETE"))).toBe(false);
  });

  it("posts every wanted reaction before it clears any stale one", async () => {
    const { impl, log } = server([ours("eyes", 1)]);
    await new GitHubReactions("1", "pem", impl).set("o/r", 7, ["hooray"]);
    const firstDelete = log.findIndex((line) => line.startsWith("DELETE"));
    const lastPost = log.map((l) => l.startsWith("POST")).lastIndexOf(true);
    expect(lastPost).toBeLessThan(firstDelete);
  });

  it("leaves the wanted reaction posted when the reconcile fails", async () => {
    const { impl, rows } = server([ours("eyes", 1)]);
    const failing = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return new Response("nope", { status: 500 });
      return impl(input, init);
    }) as unknown as typeof fetch;
    await expect(
      new GitHubReactions("1", "pem", failing).set("o/r", 7, ["hooray"]),
    ).rejects.toThrow(/500/);
    // The pull request shows too much rather than nothing, and the next status
    // change tidies it.
    expect(rows.map((r) => r.content).sort()).toEqual(["eyes", "hooray"]);
  });

  it("reads every page of reactions", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ours(i % 2 ? "eyes" : "rocket", i + 1));
    const { impl, rows } = server(many);
    await new GitHubReactions("1", "pem", impl).set("o/r", 7, []);
    expect(rows).toHaveLength(0);
  });

  it("treats a reaction that is already gone as the state that was asked for", async () => {
    const { impl } = server([ours("eyes", 1)]);
    const racing = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "DELETE") return new Response(null, { status: 404 });
      return impl(input, init);
    }) as unknown as typeof fetch;
    await expect(
      new GitHubReactions("1", "pem", racing).set("o/r", 7, ["hooray"]),
    ).resolves.toBeUndefined();
  });

  it("rejects a repo name that is not owner/name", async () => {
    const { impl } = server();
    await expect(new GitHubReactions("1", "pem", impl).set("r", 7, ["eyes"])).rejects.toThrow(
      /bad repo name/,
    );
  });
});
