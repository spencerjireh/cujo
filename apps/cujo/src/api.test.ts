import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { apiRoutes } from "./api";
import { emptyProjection } from "./folder";
import type { RunView, Runner } from "./runner";
import { Store } from "./store";

const AUTH = { "cf-access-jwt-assertion": "good" };

function build(view: RunView | null) {
  const store = new Store(":memory:");
  const changes = new EventEmitter();
  const runner = {
    changes,
    view: vi.fn(() => view),
    approve: vi.fn(async () => ({ ok: true as const })),
  } as unknown as Runner;
  const app = apiRoutes({
    store,
    runner,
    verify: async (t) => (t === "good" ? "op@example.com" : null),
  });
  return { app, store, runner, changes };
}

function blockedView(): RunView {
  const projection = emptyProjection();
  projection.status = "blocked_pending";
  projection.turnIds = ["t1"];
  projection.checks = [
    {
      threadId: "th",
      title: "tests",
      isCheck: true,
      status: "done",
      report: { ok: 1 },
      error: null,
    },
  ];
  projection.review = {
    tool: "post_blocking_review",
    toolCallId: "c1",
    body: "b",
    comments: [{ path: "a.py", line: 3, body: "off by one" }],
  };
  projection.approval = { threadId: "main", toolCallId: "c1", sourceEventId: "mm-1" };
  return {
    run: {
      id: "r1",
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      turnIds: ["t1"],
      status: "blocked_pending",
      approver: null,
      decidedAt: null,
      createdAt: "2026-08-27T00:00:00Z",
      updatedAt: "2026-08-27T00:00:00Z",
    },
    projection,
  };
}

describe("api", () => {
  it("lists runs in the flat shape", async () => {
    const { app, store } = build(null);
    const { run } = store.createRun({ repo: "o/r", prNumber: 7, headSha: "h", sessionId: "s" });
    const res = await app.request("/runs", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [
        {
          id: run.id,
          repo: "o/r",
          pr_number: 7,
          head_sha: "h",
          status: "running",
          approver: null,
          created_at: run.createdAt,
          updated_at: run.updatedAt,
        },
      ],
    });
  });

  it("serializes a run with its checks, findings, and pending approval", async () => {
    const { app } = build(blockedView());
    const res = await app.request("/runs/r1", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "r1",
      status: "blocked_pending",
      turn_ids: ["t1"],
      findings: [{ path: "a.py", line: 3, body: "off by one" }],
      approval: { threadId: "main", toolCallId: "c1" },
      external_resume: false,
    });
    expect((body.checks as unknown[]).length).toBe(1);
  });

  it("hides the approval once the run is no longer blocked_pending", async () => {
    const view = blockedView();
    view.run.status = "superseded";
    const { app } = build(view);
    const body = (await (await app.request("/runs/r1", { headers: AUTH })).json()) as {
      approval: unknown;
    };
    expect(body.approval).toBeNull();
  });

  it("answers 404 for an unknown run on both read routes", async () => {
    const { app } = build(null);
    expect((await app.request("/runs/nope", { headers: AUTH })).status).toBe(404);
    expect((await app.request("/runs/nope/events", { headers: AUTH })).status).toBe(404);
  });

  it("streams the current view first, then every change", async () => {
    const view = blockedView();
    const { app, changes } = build(view);
    const res = await app.request("/runs/r1/events", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    const readFrame = async () => decoder.decode((await reader.read()).value);

    const first = await readFrame();
    expect(first).toContain("event: run");
    expect(first).toContain("id: 0");
    expect(first).toContain('"status":"blocked_pending"');

    const next = { ...view, run: { ...view.run, status: "blocked_posted" as const } };
    changes.emit("r1", next);
    const second = await readFrame();
    expect(second).toContain("id: 1");
    expect(second).toContain('"status":"blocked_posted"');
    await reader.cancel();
  });

  it("passes the approver's email into the decision", async () => {
    const { app, runner } = build(blockedView());
    const res = await app.request("/runs/r1/approve", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ decision: "deny" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: "deny", approver: "op@example.com" });
    expect(runner.approve).toHaveBeenCalledWith("r1", "deny", "op@example.com");
  });

  it("treats an unparseable body as a bad decision", async () => {
    const { app } = build(blockedView());
    const res = await app.request("/runs/r1/approve", {
      method: "POST",
      headers: AUTH,
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
