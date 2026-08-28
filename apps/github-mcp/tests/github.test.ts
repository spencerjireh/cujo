import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getInstallationIdForRepo: vi.fn(async () => 42),
  getInstallationToken: vi.fn(async () => "ghs_token"),
}));
vi.mock("@cujo/gh-app-auth", () => auth);

import { GitHubError, createGitHubClient, splitRepo } from "../src/github";

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("splitRepo", () => {
  it("accepts owner/name only", () => {
    expect(splitRepo("o/r")).toEqual({ owner: "o", name: "r" });
    for (const bad of ["o", "o/r/x", "/r", "o/"]) {
      expect(() => splitRepo(bad)).toThrow('repo must be "owner/name"');
    }
  });
});

describe("createGitHubClient", () => {
  it("posts the review with the App token and the GitHub API headers", async () => {
    const { impl, calls } = fakeFetch(() =>
      json({ id: 9, html_url: "https://github.com/o/r/pull/1#pullrequestreview-9" }),
    );
    const client = createGitHubClient({ appId: "1", privateKey: "pem", fetch: impl });
    const created = await client.createReview("o/r", 1, {
      commitId: "abc",
      event: "REQUEST_CHANGES",
      body: "b",
      comments: [{ path: "a.py", line: 2, side: "RIGHT", body: "x" }],
    });
    expect(created.id).toBe(9);
    const call = calls[0];
    expect(call?.url.toString()).toBe("https://api.github.com/repos/o/r/pulls/1/reviews");
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer ghs_token");
    expect(headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      commit_id: "abc",
      event: "REQUEST_CHANGES",
      body: "b",
      comments: [{ path: "a.py", line: 2, side: "RIGHT", body: "x" }],
    });
  });

  it("looks the installation up once per repo and honours a custom API base", async () => {
    auth.getInstallationIdForRepo.mockClear();
    const { impl, calls } = fakeFetch(() => json([]));
    const client = createGitHubClient({
      appId: "1",
      privateKey: "pem",
      fetch: impl,
      apiBase: "https://ghe.example/api/v3/",
    });
    await client.listPullFiles("org/repo", 1);
    await client.listPullFiles("org/repo", 2);
    expect(auth.getInstallationIdForRepo).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url.toString()).toBe(
      "https://ghe.example/api/v3/repos/org/repo/pulls/1/files?per_page=100&page=1",
    );
  });

  it("pages through changed files until a short page", async () => {
    const { impl, calls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      return json(Array.from({ length: page === 1 ? 100 : 1 }, () => ({ filename: "f" })));
    });
    const client = createGitHubClient({ appId: "1", privateKey: "pem", fetch: impl });
    expect(await client.listPullFiles("o/paged", 1)).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it("carries the status as a field, and retries the lookup after a failure", async () => {
    auth.getInstallationIdForRepo.mockClear();
    auth.getInstallationIdForRepo.mockRejectedValueOnce(new Error("no installation"));
    const { impl } = fakeFetch(() => json({ message: "Validation Failed" }, 422));
    const client = createGitHubClient({ appId: "1", privateKey: "pem", fetch: impl });
    await expect(client.listPullFiles("o/fail", 1)).rejects.toThrow("no installation");
    const error = await client.listPullFiles("o/fail", 1).catch((e: unknown) => e);
    // A field, so `errorFields` can classify it and a caller can tell an
    // expected 404 from an outage without a regular expression.
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ status: 422, method: "GET" });
    expect((error as GitHubError).path).toContain("/repos/o/fail/pulls/1/files");
    expect(auth.getInstallationIdForRepo).toHaveBeenCalledTimes(2);
  });

  it("takes GitHub's own message and never the raw body", async () => {
    // The body used to be interpolated whole, which is how an upstream payload
    // that echoes a header back reaches a log line.
    const { impl } = fakeFetch(() =>
      json({ message: "Validation Failed", token: "ghs_leaked_value_here" }, 422),
    );
    const client = createGitHubClient({ appId: "1", privateKey: "pem", fetch: impl });
    const error = await client.listPullFiles("o/r", 1).catch((e: unknown) => e);
    expect((error as Error).message).toContain("Validation Failed");
    expect((error as Error).message).not.toContain("ghs_leaked_value_here");
  });

  it("says nothing extra when the body is not GitHub's envelope", async () => {
    const { impl } = fakeFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const client = createGitHubClient({ appId: "1", privateKey: "pem", fetch: impl });
    const error = await client.listPullFiles("o/r", 1).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("html");
    expect(error).toMatchObject({ status: 502 });
  });
});
