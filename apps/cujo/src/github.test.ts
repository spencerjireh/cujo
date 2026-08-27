import { describe, expect, it, vi } from "vitest";

vi.mock("@cujo/gh-app-auth", () => ({
  normalisePrivateKey: (pem: string) => pem,
  getInstallationIdForRepo: vi.fn(async () => 42),
  getInstallationToken: vi.fn(async () => "ghs_token"),
  getAppJwt: vi.fn(async () => "app_jwt"),
}));

import { GitHubReader } from "./github";

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

  it("throws rather than return a short list when GitHub refuses", async () => {
    const impl = vi.fn(async () => new Response("{}", { status: 500 }));
    const reader = new GitHubReader("1", "pem", impl as unknown as typeof fetch);
    await expect(reader.installedRepos()).rejects.toThrow("returned 500");
  });
});
