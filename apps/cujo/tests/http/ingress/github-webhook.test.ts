import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader } from "../../../src/clients/github";
import { verifySignature } from "../../../src/http/ingress/github-webhook";
import { createApp } from "../../../src/http/router";
import type { Runner } from "../../../src/review/runner.service";
import { Store } from "../../../src/store";
import { HOOK, UI, build, prOf, req } from "../helpers";

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
      api: {
        runs: store.runs,
        notifications: store.notifications,
        runner,
        verify: async () => null,
      },
      webhook: {
        secret: "s3",
        github: {} as GitHubReader,
        store: store.runs,
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

  const deliver = (app: ReturnType<typeof build>["app"], body = payload) =>
    app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(body) },
        body,
      }),
    );

  it("claims one run per head, so a duplicate delivery starts nothing", async () => {
    const { app, runner, nextSettled } = build();
    const done = nextSettled();
    const [a, b] = await Promise.all([deliver(app), deliver(app)]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    const dup = a.status === 200 ? a : b;
    expect(await dup.json()).toMatchObject({ ignored: "duplicate delivery" });
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("rejects an unsigned delivery and accepts a signed one with 202", async () => {
    const { app, store, runner, nextSettled } = build();
    const headers = { "x-github-event": "pull_request", "content-type": "application/json" };
    const unsigned = await app.fetch(
      req(HOOK, "/webhook", { method: "POST", headers, body: payload }),
    );
    expect(unsigned.status).toBe(401);
    const done = nextSettled();
    const signed = await deliver(app);
    expect(signed.status).toBe(202);
    const body = (await signed.json()) as { run_id: string };
    expect(store.runs.getRun(body.run_id)?.sessionId).toBe("sess-1");
    expect(store.runs.getSession("o/r", 7)).toBe("sess-1");
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("answers before the GitHub reads, then releases a head the bot already reviewed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const github = {
      alreadyReviewed: vi.fn(async () => {
        await gate;
        return true;
      }),
      pullRequest: vi.fn(),
    } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    const done = nextSettled();
    const res = await deliver(app);
    // 202 arrived while alreadyReviewed is still pending.
    expect(res.status).toBe(202);
    expect(store.runs.listRuns()).toHaveLength(1);
    release();
    await done;
    expect(runner.start).not.toHaveBeenCalled();
    // The claimed row is released so a later real run for this head is possible.
    expect(store.runs.listRuns()).toHaveLength(0);
  });

  it("ends a run whose preparation fails and lets a redelivery re-claim the head", async () => {
    const pullRequest = vi.fn().mockRejectedValueOnce(new Error("502 from GitHub"));
    pullRequest.mockResolvedValue(prOf("h"));
    const github = {
      alreadyReviewed: vi.fn(async () => false),
      pullRequest,
    } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });

    let done = nextSettled();
    const first = await deliver(app);
    expect(first.status).toBe(202);
    const firstId = await done;
    expect(runner.fail).toHaveBeenCalledWith(firstId, expect.stringContaining("502 from GitHub"));
    expect(store.runs.getRun(firstId)).toMatchObject({ status: "error", turnIds: [] });

    done = nextSettled();
    const second = await deliver(app);
    expect(second.status).toBe(202);
    const secondId = await done;
    expect(secondId).not.toBe(firstId);
    expect(runner.start).toHaveBeenCalledOnce();
    expect(store.runs.getRun(firstId)).toBeNull();
  });

  const headPayload = (sha: string) =>
    JSON.stringify({
      action: "synchronize",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha } },
    });

  it("supersedes the unfinished run of an older head when a newer one arrives", async () => {
    const pullRequest = vi.fn(async () => prOf("h"));
    const github = { alreadyReviewed: async () => false, pullRequest } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    let done = nextSettled();
    const first = (await (await deliver(app)).json()) as { run_id: string };
    await done;
    store.runs.updateRun(first.run_id, { status: "blocked_pending" });

    // GitHub now reports h2 as the head.
    pullRequest.mockResolvedValue(prOf("h2"));
    done = nextSettled();
    const second = (await (await deliver(app, headPayload("h2"))).json()) as { run_id: string };
    await done;
    expect(runner.supersede).toHaveBeenCalledWith(first.run_id);
    expect(runner.supersede).not.toHaveBeenCalledWith(second.run_id);
    expect(store.runs.getRun(first.run_id)?.status).toBe("superseded");
    expect(runner.start).toHaveBeenCalledTimes(2);
  });

  it("does not let a delayed delivery for an older head replace the current run", async () => {
    // GitHub's head is h2 throughout; the h1 delivery arrives late.
    const pullRequest = vi.fn(async () => prOf("h2"));
    const github = { alreadyReviewed: async () => false, pullRequest } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    let done = nextSettled();
    const current = (await (await deliver(app, headPayload("h2"))).json()) as { run_id: string };
    await done;
    expect(runner.start).toHaveBeenCalledOnce();

    done = nextSettled();
    const stale = (await (await deliver(app, headPayload("h1"))).json()) as { run_id: string };
    await done;
    expect(runner.supersede).toHaveBeenCalledWith(stale.run_id);
    expect(runner.supersede).not.toHaveBeenCalledWith(current.run_id);
    expect(store.runs.getRun(stale.run_id)?.status).toBe("superseded");
    expect(store.runs.getRun(current.run_id)?.status).toBe("running");
    expect(runner.start).toHaveBeenCalledOnce();
  });
});
