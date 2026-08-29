import { describe, expect, it, vi } from "vitest";

vi.mock("@cujo/gh-app-auth", () => ({
  normalisePrivateKey: (pem: string) => pem,
  getInstallationIdForRepo: vi.fn(async () => 42),
  getInstallationToken: vi.fn(async () => "ghs_token"),
  getAppJwt: vi.fn(async () => "app_jwt"),
}));

import { COMMENT_BODY_CAP, GitHubReader, parseDeclaredGuild } from "../../src/clients/github";

type Route = (url: URL) => { status?: number; body: unknown };

function fakeFetch(route: Route) {
  const calls: URL[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghs_token");
    const { status = 200, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const pr = {
  title: "t",
  body: null,
  base: { sha: "b", repo: { clone_url: "https://github.com/o/r.git" } },
  head: { sha: "h" },
};

describe("GitHubReader.pullRequest", () => {
  it("reads the PR and every page of changed files", async () => {
    const { impl, calls } = fakeFetch((url) => {
      if (url.pathname.endsWith("/files")) {
        const page = Number(url.searchParams.get("page"));
        const count = page === 1 ? 100 : 3;
        return { body: Array.from({ length: count }, (_, i) => ({ filename: `p${page}-${i}` })) };
      }
      return { body: pr };
    });
    const reader = new GitHubReader("1", "pem", impl);
    const info = await reader.pullRequest("o/r", 7);
    expect(info).toMatchObject({
      repo: "o/r",
      prNumber: 7,
      body: "",
      baseSha: "b",
      headSha: "h",
      cloneUrl: "https://github.com/o/r.git",
    });
    expect(info.changedFiles).toHaveLength(103);
    expect(calls.map((u) => u.pathname + u.search)).toEqual([
      "/repos/o/r/pulls/7",
      "/repos/o/r/pulls/7/files?per_page=100&page=1",
      "/repos/o/r/pulls/7/files?per_page=100&page=2",
    ]);
  });

  it("throws with the status on a failed read", async () => {
    const { impl } = fakeFetch(() => ({ status: 502, body: {} }));
    await expect(new GitHubReader("1", "pem", impl).pullRequest("o/r", 7)).rejects.toThrow(
      "GitHub /repos/o/r/pulls/7 returned 502",
    );
  });

  it("rejects a repo name that is not owner/name", async () => {
    const { impl } = fakeFetch(() => ({ body: pr }));
    await expect(new GitHubReader("1", "pem", impl).pullRequest("nope", 7)).rejects.toThrow(
      "bad repo name: nope",
    );
  });
});

describe("GitHubReader.alreadyReviewed", () => {
  const review = (login: string, sha: string) => ({ user: { login }, commit_id: sha });

  it("finds the bot's review of the head on a later page and stops there", async () => {
    const { impl, calls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) return { body: Array(100).fill(review("someone", "h")) };
      if (page === 2)
        return { body: [review("cujo-guard[bot]", "old"), review("cujo-guard[bot]", "h")] };
      return { body: [] };
    });
    const reader = new GitHubReader("1", "pem", impl);
    expect(await reader.alreadyReviewed("o/r", 7, "h")).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("is false when the bot reviewed only another head, and tolerates deleted users", async () => {
    const { impl } = fakeFetch(() => ({
      body: [review("cujo-guard[bot]", "old"), { user: null, commit_id: "h" }],
    }));
    expect(await new GitHubReader("1", "pem", impl).alreadyReviewed("o/r", 7, "h")).toBe(false);
  });
});

describe("parseDeclaredGuild", () => {
  it("reads the key whether or not it is quoted, and ignores a trailing comment", () => {
    expect(parseDeclaredGuild('discord_guild: "222222222222222222"')).toBe("222222222222222222");
    expect(parseDeclaredGuild("discord_guild: 222222222222222222")).toBe("222222222222222222");
    expect(parseDeclaredGuild("discord_guild: '222222222222222222'  # ours")).toBe(
      "222222222222222222",
    );
    expect(parseDeclaredGuild("test: uv run pytest\ndiscord_guild: 222222222222222222\n")).toBe(
      "222222222222222222",
    );
  });

  it("ignores anything that is not a top-level snowflake", () => {
    // Not a snowflake, so not a declaration. That is the whole validation.
    expect(parseDeclaredGuild("discord_guild: not-an-id")).toBeNull();
    expect(parseDeclaredGuild("discord_guild: 12")).toBeNull();
    expect(parseDeclaredGuild("")).toBeNull();
    expect(parseDeclaredGuild("install: uv sync")).toBeNull();
    // Nested under another key is not the top level.
    expect(parseDeclaredGuild("smoke:\n  discord_guild: 222222222222222222")).toBeNull();
    // A near-miss key name must not match.
    expect(parseDeclaredGuild("my_discord_guild: 222222222222222222")).toBeNull();
  });
});

describe("GitHubReader.declaredGuild", () => {
  function fakeConfigFetch(file: { status: number; body: string }) {
    const paths: string[] = [];
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      paths.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/repos/o/r") {
        return new Response(JSON.stringify({ default_branch: "trunk" }), { status: 200 });
      }
      return new Response(file.body, { status: file.status });
    });
    return { impl: impl as unknown as typeof fetch, paths, calls: impl };
  }

  it("reads .cujo.yml from the default branch, not from a pull request", async () => {
    const { impl, paths } = fakeConfigFetch({
      status: 200,
      body: 'discord_guild: "222222222222222222"\n',
    });
    const reader = new GitHubReader("1", "pem", impl);
    expect(await reader.declaredGuild("o/r")).toBe("222222222222222222");
    // The declaration has to be merged, which is what makes it proof.
    expect(paths).toContain("/repos/o/r/contents/.cujo.yml?ref=trunk");
  });

  it("is null when the repo has no .cujo.yml", async () => {
    const { impl } = fakeConfigFetch({ status: 404, body: "{}" });
    expect(await new GitHubReader("1", "pem", impl).declaredGuild("o/r")).toBeNull();
  });

  it("throws when GitHub refuses, because that is not the same as no declaration", async () => {
    // A caller deciding whether to keep notifying has to tell "the repo says
    // no server" from "GitHub did not answer".
    const { impl } = fakeConfigFetch({ status: 500, body: "{}" });
    await expect(new GitHubReader("1", "pem", impl).declaredGuild("o/r")).rejects.toThrow(
      "returned 500",
    );
  });

  it("encodes the ref, so a branch name with a # is not truncated", async () => {
    const paths: string[] = [];
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      paths.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/repos/o/r") {
        return new Response(JSON.stringify({ default_branch: "release/1.0#rc" }), { status: 200 });
      }
      return new Response("discord_guild: 222222222222222222", { status: 200 });
    });
    const reader = new GitHubReader("1", "pem", impl as unknown as typeof fetch);
    expect(await reader.declaredGuild("o/r")).toBe("222222222222222222");
    expect(paths).toContain("/repos/o/r/contents/.cujo.yml?ref=release%2F1.0%23rc");
  });

  it("re-reads on `fresh`, so a mid-command revocation is seen", async () => {
    const { impl, calls } = fakeConfigFetch({
      status: 200,
      body: "discord_guild: 222222222222222222",
    });
    const reader = new GitHubReader("1", "pem", impl);
    await reader.declaredGuild("o/r");
    const after = calls.mock.calls.length;
    await reader.declaredGuild("o/r", { fresh: true });
    expect(calls.mock.calls.length).toBeGreaterThan(after);
  });

  it("caches, so a status command does not re-read for every repo", async () => {
    const { impl, calls } = fakeConfigFetch({
      status: 200,
      body: "discord_guild: 222222222222222222",
    });
    const reader = new GitHubReader("1", "pem", impl);
    await reader.declaredGuild("o/r");
    const after = calls.mock.calls.length;
    await reader.declaredGuild("o/r");
    expect(calls.mock.calls.length).toBe(after);
  });
});

describe("GitHubReader.installedRepos", () => {
  /** The App JWT and an installation token authenticate different calls here. */
  function fakeAppFetch(repos: string[]) {
    const auth: string[] = [];
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      auth.push(new Headers(init?.headers).get("authorization") ?? "");
      const body = url.pathname.endsWith("/app/installations")
        ? [{ id: 42 }]
        : { repositories: repos.map((full_name) => ({ full_name })) };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return { impl: impl as unknown as typeof fetch, calls: impl, auth };
  }

  it("lists every repo the App is installed on, sorted and deduplicated", async () => {
    const { impl, auth } = fakeAppFetch(["o/b", "o/a", "o/a"]);
    const reader = new GitHubReader("1", "pem", impl);
    expect(await reader.installedRepos()).toEqual(["o/a", "o/b"]);
    // The installation list is the App's own read; the repos are the
    // installation's.
    expect(auth[0]).toBe("Bearer app_jwt");
    expect(auth[1]).toBe("Bearer ghs_token");
  });

  it("caches, because autocomplete asks on every keystroke", async () => {
    const { impl, calls } = fakeAppFetch(["o/a"]);
    const reader = new GitHubReader("1", "pem", impl);
    await reader.installedRepos();
    const after = calls.mock.calls.length;
    await reader.installedRepos();
    expect(calls.mock.calls.length).toBe(after);
  });

  it("scans once for a burst of concurrent callers", async () => {
    // Autocomplete arrives per keystroke; without single flight each one would
    // start its own installation-and-repository scan.
    const { impl, calls } = fakeAppFetch(["o/a"]);
    const reader = new GitHubReader("1", "pem", impl);
    const [first, second, third] = await Promise.all([
      reader.installedRepos(),
      reader.installedRepos(),
      reader.installedRepos(),
    ]);
    expect(first).toEqual(["o/a"]);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // One installations page plus one repositories page.
    expect(calls.mock.calls.length).toBe(2);
  });

  it("pages through the installations rather than stopping at the first hundred", async () => {
    const pages: string[] = [];
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      pages.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/app/installations")) {
        const page = Number(url.searchParams.get("page"));
        // A full page means there may be more.
        const body = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i })) : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({ repositories: [{ full_name: "o/a" }] }), {
        status: 200,
      });
    });
    const reader = new GitHubReader("1", "pem", impl as unknown as typeof fetch);
    expect(await reader.installedRepos()).toEqual(["o/a"]);
    expect(pages).toContain("/app/installations?per_page=100&page=2");
  });

  it("throws rather than return a short list when GitHub refuses", async () => {
    const impl = vi.fn(async () => new Response("{}", { status: 500 }));
    const reader = new GitHubReader("1", "pem", impl as unknown as typeof fetch);
    await expect(reader.installedRepos()).rejects.toThrow("returned 500");
  });
});

/**
 * Three answers rather than two (decision 34). `unknown` is the one that
 * matters: the sweep leaves a stamp alone when GitHub could not be asked, so a
 * transient failure must never be reported as "private" and take the public
 * board dark.
 */
describe("GitHubReader.repoIsPublic", () => {
  const reader = (impl: unknown) => new GitHubReader("1", "pem", impl as typeof fetch);

  it.each([
    ["public when the repo says private is false", 200, { private: false }, "public"],
    ["private when the repo says private is true", 200, { private: true }, "private"],
    ["private when the body carries no private field", 200, {}, "private"],
    ["private when the repo is gone", 404, {}, "private"],
    ["private when the repo is gone for good", 410, {}, "private"],
    ["unknown when GitHub errors", 500, {}, "unknown"],
    ["unknown when GitHub rate limits", 403, {}, "unknown"],
  ])("reads %s", async (_name, status, body, expected) => {
    const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    expect(await reader(impl).repoIsPublic("o/r")).toBe(expected);
  });

  it("is unknown, not private, when the request itself throws", async () => {
    const impl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await reader(impl).repoIsPublic("o/r")).toBe("unknown");
  });

  it("does not cache, because freshness is the whole job", async () => {
    const impl = vi.fn(
      async () => new Response(JSON.stringify({ private: false }), { status: 200 }),
    );
    const r = reader(impl);
    await r.repoIsPublic("o/r");
    await r.repoIsPublic("o/r");
    expect(impl).toHaveBeenCalledTimes(2);
  });
});

describe("GitHubReader.createComment", () => {
  function commentServer(status = 201) {
    const bodies: string[] = [];
    const paths: string[] = [];
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      paths.push(new URL(String(input)).pathname);
      bodies.push(String(init?.body));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return new Response(JSON.stringify({ id: 4242 }), { status });
    });
    return { impl: impl as unknown as typeof fetch, bodies, paths };
  }

  it("posts to the pull request's comment list and returns the new id", async () => {
    const { impl, paths, bodies } = commentServer();
    const id = await new GitHubReader("1", "pem", impl).createComment("o/r", 7, "hello");
    expect(id).toBe(4242);
    expect(paths).toEqual(["/repos/o/r/issues/7/comments"]);
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ body: "hello" });
  });

  it("caps a long body rather than letting GitHub refuse the whole reply", async () => {
    // The text can be a model's, and the one call that must not fail is the
    // one explaining why something was refused.
    const { impl, bodies } = commentServer();
    await new GitHubReader("1", "pem", impl).createComment("o/r", 7, "x".repeat(20_000));
    const sent = (JSON.parse(bodies[0] ?? "{}") as { body: string }).body;
    expect(sent.length).toBe(COMMENT_BODY_CAP);
    expect(sent.endsWith("_(truncated)_")).toBe(true);
  });

  it("throws a typed GitHubError so the caller can log a status, not a body", async () => {
    const { impl } = commentServer(403);
    await expect(
      new GitHubReader("1", "pem", impl).createComment("o/r", 7, "hello"),
    ).rejects.toMatchObject({ status: 403, path: "/repos/o/r/issues/7/comments" });
  });
});
