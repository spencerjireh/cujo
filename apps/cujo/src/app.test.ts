import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { GitHubReader } from "./github";
import type { Runner } from "./runner";
import { Store } from "./store";
import { verifySignature } from "./webhook";

const UI = "cujo.test";
const HOOK = "cujo-ingress.test";

function build(overrides: Partial<{ runner: Runner; github: GitHubReader }> = {}) {
  const store = new Store(":memory:");
  const runner =
    overrides.runner ??
    ({ view: () => null, start: vi.fn(), approve: vi.fn() } as unknown as Runner);
  const github =
    overrides.github ??
    ({
      alreadyReviewed: vi.fn(async () => false),
      pullRequest: vi.fn(async () => ({
        repo: "o/r",
        prNumber: 7,
        title: "t",
        body: "",
        baseSha: "b",
        headSha: "h",
        cloneUrl: "https://github.com/o/r.git",
        changedFiles: ["a.py"],
      })),
    } as unknown as GitHubReader);
  const app = createApp({
    uiHost: UI,
    webhookHost: HOOK,
    api: { store, runner, verify: async (t) => (t === "good" ? "op@example.com" : null) },
    webhook: { secret: "s3", github, store, runner, createSession: async () => "sess-1" },
  });
  return { app, store, runner, github };
}

const req = (host: string, path: string, init?: RequestInit) =>
  new Request(`http://${host}${path}`, { ...init, headers: { host, ...(init?.headers ?? {}) } });

describe("host dispatch", () => {
  it("serves healthz on both hosts", async () => {
    const { app } = build();
    for (const host of [UI, HOOK]) {
      const res = await app.fetch(req(host, "/healthz"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, service: "cujo" });
    }
  });

  it("answers 404 on an unknown host and on the wrong route per host", async () => {
    const { app } = build();
    expect((await app.fetch(req("other.test", "/healthz"))).status).toBe(404);
    expect((await app.fetch(req(HOOK, "/runs"))).status).toBe(404);
    expect((await app.fetch(req(UI, "/webhook", { method: "POST" }))).status).toBe(404);
  });

  it("requires an Access assertion on every UI route", async () => {
    const { app } = build();
    expect((await app.fetch(req(UI, "/runs"))).status).toBe(401);
    const ok = await app.fetch(
      req(UI, "/runs", { headers: { "cf-access-jwt-assertion": "good" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ runs: [] });
  });
});

describe("approve route", () => {
  it("rejects a bad decision and passes the approver through", async () => {
    const approve = vi.fn(async () => ({
      ok: false as const,
      reason: "run is clean, not blocked_pending",
    }));
    const runner = { view: () => null, start: vi.fn(), approve } as unknown as Runner;
    const { app } = build({ runner });
    const headers = { "cf-access-jwt-assertion": "good", "content-type": "application/json" };
    const bad = await app.fetch(
      req(UI, "/runs/r1/approve", {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "maybe" }),
      }),
    );
    expect(bad.status).toBe(400);
    const res = await app.fetch(
      req(UI, "/runs/r1/approve", {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "allow" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(approve).toHaveBeenCalledWith("r1", "allow", "op@example.com");
  });
});

describe("webhook", () => {
  const sign = (body: string) => `sha256=${createHmac("sha256", "s3").update(body).digest("hex")}`;
  const payload = JSON.stringify({
    action: "opened",
    number: 7,
    repository: { full_name: "o/r" },
    pull_request: { head: { sha: "h" } },
  });

  it("verifies signatures in constant time and rejects malformed ones", () => {
    expect(verifySignature("s3", payload, sign(payload))).toBe(true);
    expect(verifySignature("s3", payload, "sha256=00")).toBe(false);
    expect(verifySignature("s3", payload, `sha256=${"z".repeat(64)}`)).toBe(false);
    expect(verifySignature("s3", payload, undefined)).toBe(false);
    expect(verifySignature("other", payload, sign(payload))).toBe(false);
  });

  it("answers 503 while the harness is not ready", async () => {
    const store = new Store(":memory:");
    const runner = { view: () => null, start: vi.fn() } as unknown as Runner;
    const app = createApp({
      uiHost: UI,
      webhookHost: HOOK,
      api: { store, runner, verify: async () => null },
      webhook: {
        secret: "s3",
        github: {} as GitHubReader,
        store,
        runner,
        createSession: async () => "sess-1",
        isReady: () => false,
      },
    });
    const res = await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(payload) },
        body: payload,
      }),
    );
    expect(res.status).toBe(503);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("claims one run per head, so a duplicate delivery starts nothing", async () => {
    const { app, runner } = build();
    const headers = { "x-github-event": "pull_request", "x-hub-signature-256": sign(payload) };
    const send = () => app.fetch(req(HOOK, "/webhook", { method: "POST", headers, body: payload }));
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    const dup = a.status === 200 ? a : b;
    expect(await dup.json()).toMatchObject({ ignored: "duplicate delivery" });
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("rejects an unsigned delivery and accepts a signed one with 202", async () => {
    const { app, store, runner } = build();
    const headers = { "x-github-event": "pull_request", "content-type": "application/json" };
    const unsigned = await app.fetch(
      req(HOOK, "/webhook", { method: "POST", headers, body: payload }),
    );
    expect(unsigned.status).toBe(401);
    const signed = await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { ...headers, "x-hub-signature-256": sign(payload) },
        body: payload,
      }),
    );
    expect(signed.status).toBe(202);
    const body = (await signed.json()) as { run_id: string };
    expect(store.getRun(body.run_id)?.sessionId).toBe("sess-1");
    expect(store.getSession("o/r", 7)).toBe("sess-1");
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("skips a head SHA the bot already reviewed", async () => {
    const github = {
      alreadyReviewed: vi.fn(async () => true),
      pullRequest: vi.fn(),
    } as unknown as GitHubReader;
    const { app, runner, store } = build({ github });
    const res = await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(payload) },
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "already reviewed" });
    expect(runner.start).not.toHaveBeenCalled();
    // The claimed row is released so a later real run for this head is possible.
    expect(store.listRuns()).toHaveLength(0);
  });
});
