import { describe, expect, it, vi } from "vitest";

vi.mock("@cujo/gh-app-auth", () => ({
  normalisePrivateKey: (pem: string) => pem,
  getInstallationIdForRepo: vi.fn(async () => 42),
  getInstallationToken: vi.fn(async () => "ghs_token"),
  getAppJwt: vi.fn(async () => "app_jwt"),
}));

import { CHECK_NAME, type CheckPayload, GitHubChecks } from "../../src/clients/github-checks";

const payload: CheckPayload = {
  runId: "run-1",
  status: "completed",
  conclusion: "failure",
  detailsUrl: "https://cujo.example.com/runs/run-1",
  output: { title: "Blocked.", summary: "1 critical, 0 warn, 0 info." },
};

/**
 * A GitHub that lists the commit's check runs by name and app, assigns an id
 * on POST, and accepts a PATCH by id.
 */
function server(existing: number[] = []) {
  const log: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    log.push({ method, path: url.pathname + url.search, body });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghs_token");
    if (method === "GET") {
      expect(url.searchParams.get("check_name")).toBe(CHECK_NAME);
      expect(url.searchParams.get("app_id")).toBe("1");
      return new Response(JSON.stringify({ check_runs: existing.map((id) => ({ id })) }));
    }
    if (method === "POST") return new Response(JSON.stringify({ id: 900 }), { status: 201 });
    const id = Number(url.pathname.split("/").at(-1));
    return new Response(JSON.stringify({ id }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, log };
}

describe("GitHubChecks", () => {
  it("looks the check up by name and app, and PATCHes the one it finds", async () => {
    const { impl, log } = server([77]);
    const checks = new GitHubChecks("1", "pem", impl);
    expect(await checks.write("o/r", "abc", payload)).toBe(77);
    expect(log.map((l) => l.method)).toEqual(["GET", "PATCH"]);
    expect(log[1]?.path).toBe("/repos/o/r/check-runs/77");
    expect(log[1]?.body).toEqual({
      name: "cujo/guard",
      head_sha: "abc",
      external_id: "run-1",
      status: "completed",
      conclusion: "failure",
      details_url: "https://cujo.example.com/runs/run-1",
      output: { title: "Blocked.", summary: "1 critical, 0 warn, 0 info." },
    });
  });

  it("POSTs when the commit has no check yet, and returns the new id", async () => {
    const { impl, log } = server([]);
    const checks = new GitHubChecks("1", "pem", impl);
    expect(await checks.write("o/r", "abc", payload)).toBe(900);
    expect(log.map((l) => l.method)).toEqual(["GET", "POST"]);
    expect(log[1]?.path).toBe("/repos/o/r/check-runs");
  });

  it("skips the lookup when the caller already knows the id", async () => {
    const { impl, log } = server([77]);
    const checks = new GitHubChecks("1", "pem", impl);
    await checks.write("o/r", "abc", payload, 77);
    expect(log.map((l) => l.method)).toEqual(["PATCH"]);
  });

  it("sends no conclusion and no details URL when there is none", async () => {
    const { impl, log } = server([]);
    const checks = new GitHubChecks("1", "pem", impl);
    await checks.write("o/r", "abc", {
      runId: "run-1",
      status: "in_progress",
      detailsUrl: null,
      output: { title: "Running.", summary: "Cujo is reviewing this commit." },
    });
    expect(log[1]?.body).not.toHaveProperty("conclusion");
    expect(log[1]?.body).not.toHaveProperty("details_url");
  });

  it("throws with the status on a refused write, so the projector can retry", async () => {
    const impl = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const checks = new GitHubChecks("1", "pem", impl);
    await expect(checks.write("o/r", "abc", payload)).rejects.toThrow("returned 403");
  });
});
