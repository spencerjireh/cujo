/**
 * The public routes. No request below carries an Access header, which is the
 * point: this plane has no gate, so what protects it is what it refuses to
 * answer and what it refuses to say.
 */

import { describe, expect, it, vi } from "vitest";
import { build, runOf, viewOf } from "./helpers";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

describe("public runs list", () => {
  it("lists public runs and no others", async () => {
    const { app, store } = build(null);
    const open = store.runs.createRun(head).run;
    store.runs.createRun({ ...head, repo: "o/secret", isPublic: false });
    const res = await app.request("/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { id: string; repo: string }[] };
    expect(body.runs.map((r) => r.id)).toEqual([open.id]);
  });

  /**
   * A row written before the column existed answers nothing, and the SQL filter
   * is what excludes it — not a check in this route.
   */
  it("excludes a run whose visibility was never answered", async () => {
    const { app, store } = build(null);
    const run = store.runs.createRun(head).run;
    store.runs.setRepoVisibility("o/r", false);
    expect((await (await app.request("/runs")).json()) as { runs: unknown[] }).toEqual({
      runs: [],
    });
    expect(run.isPublic).toBe(true); // the record handed back at claim time
  });

  it("names nobody, even for a decided run", async () => {
    const { app, store } = build(null);
    const run = store.runs.createRun(head).run;
    store.runs.updateRun(run.id, { status: "blocked_pending" });
    store.runs.claimDecision(run.id, "operator@example.com", "2026-08-28T00:00:00.000Z");
    const text = await (await app.request("/runs")).text();
    expect(text).not.toContain("operator@example.com");
    expect(text).not.toContain("approver");
  });
});

describe("public run detail", () => {
  it("returns the public shape for a public run", async () => {
    const { app } = build(viewOf(runOf()));
    const res = await app.request("/runs/r1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("approver");
    expect(body).not.toHaveProperty("session_id");
    expect(body).not.toHaveProperty("approval");
    expect(body.id).toBe("r1");
  });

  /** 404 and not 403: the plane does not confirm that a private repo has runs. */
  it("404s a private run exactly as it 404s an unknown one", async () => {
    const priv = build(viewOf(runOf({ isPublic: false })));
    const unknown = build(null);
    const a = await priv.app.request("/runs/r1");
    const b = await unknown.app.request("/runs/nope");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
  });

  it("404s the stream for a private run", async () => {
    const { app } = build(viewOf(runOf({ isPublic: false })));
    expect((await app.request("/runs/r1/events")).status).toBe(404);
  });

  it("answers 404 to anything else on the plane", async () => {
    const { app } = build(null);
    expect((await app.request("/runs/r1/approve", { method: "POST" })).status).toBe(404);
    expect((await app.request("/discord/channels")).status).toBe(404);
  });
});

describe("public run stream", () => {
  const frames = (res: Response) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    return { reader, next: async () => decoder.decode((await reader.read()).value) };
  };

  it("sends the public shape first, then every change", async () => {
    const view = viewOf(runOf({ status: "blocked_pending" }));
    const { app, changes } = build(view);
    const res = await app.request("/runs/r1/events");
    expect(res.status).toBe(200);
    const { reader, next } = frames(res);

    const first = await next();
    expect(first).toContain("event: run");
    expect(first).toContain('"status":"blocked_pending"');
    expect(first).not.toContain("approver");

    changes.emit("r1", viewOf(runOf({ status: "blocked_posted" })));
    expect(await next()).toContain('"status":"blocked_posted"');
    await reader.cancel();
  });

  /**
   * A flip is a store write and emits nothing of its own, so the stream has to
   * notice it on the next frame it does see.
   */
  it("closes the stream when the repo goes private mid-stream", async () => {
    const { app, changes } = build(viewOf(runOf()));
    const res = await app.request("/runs/r1/events");
    const { reader, next } = frames(res);
    await next();

    changes.emit("r1", viewOf(runOf({ isPublic: false, status: "clean" })));
    // End of stream, not another frame. Were the flip ignored, this read would
    // hang until the test timed out rather than resolving.
    expect((await reader.read()).done).toBe(true);
  });

  it("refuses a stream past the cap with 503 and a retry hint, and recovers", async () => {
    const { app, limit } = build(viewOf(runOf()), { streamLimit: 1 });
    const first = await app.request("/runs/r1/events");
    expect(first.status).toBe(200);
    const { reader, next } = frames(first);
    await next();
    expect(limit.active()).toBe(1);

    const second = await app.request("/runs/r1/events");
    expect(second.status).toBe(503);
    expect(second.headers.get("retry-after")).toBe("30");

    await reader.cancel();
    await vi.waitFor(() => expect(limit.active()).toBe(0));
    const third = await app.request("/runs/r1/events");
    expect(third.status).toBe(200);
    await third.body?.cancel();
  });
});
