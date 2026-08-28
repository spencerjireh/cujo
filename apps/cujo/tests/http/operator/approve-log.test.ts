/**
 * The audit trail for the one action a human takes with their own name on it,
 * and the reasons behind a 401 and a 409 (decision 37).
 *
 * Both used to collapse several conditions into one answer. That is right for
 * the caller — naming the failing check tells a stranger how to pass it — and
 * wrong for the operator debugging their own login, so the distinction lives
 * in the log rather than in the response.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/http/operator/access";
import type { RunView } from "../../../src/review/runner.service";
import { AUTH, build } from "./helpers";

const view = (status: string): RunView =>
  ({
    run: {
      id: "r1",
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      turnIds: ["t1"],
      status,
      approver: null,
      decidedAt: null,
      isPublic: true,
      deliveryId: "delivery-1",
      createdAt: "2026-08-27T00:00:00Z",
      updatedAt: "2026-08-27T00:00:00Z",
    },
    projection: { approval: { threadId: "main", toolCallId: "c1", sourceEventId: "e1" } },
  }) as unknown as RunView;

const approve = (app: Hono<Env>, runId: string, body = "allow") =>
  app.fetch(
    new Request(`http://cujo.test/runs/${runId}/approve`, {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ decision: body }),
    }),
  );

describe("approve.requested", () => {
  it("names the operator, the decision and the run before the outcome is known", async () => {
    const { app, logged, runId } = build(view("blocked_pending"));
    await approve(app, runId);
    expect(logged("approve.requested")[0]).toMatchObject({
      run_id: runId,
      decision: "allow",
      actor: "op@example.com",
    });
  });

  it("carries the request that decided and the delivery that started the run", async () => {
    // Two facts, and the point is that they are two. The previous version of
    // this test was named for the distinction and never checked it: it read
    // only `request_ray`, which the handler set from the same request ray the
    // middleware had already bound, so the two ids on the line were always
    // equal and nothing said so.
    const { app, logged, runId } = build(view("blocked_pending"));
    await app.fetch(
      new Request(`http://cujo.test/runs/${runId}/approve`, {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json", "cf-ray": "operator-ray" },
        body: JSON.stringify({ decision: "deny" }),
      }),
    );
    const [line] = logged("approve.requested");
    expect(line).toMatchObject({
      ray: "operator-ray",
      delivery_id: "delivery-1",
      decision: "deny",
    });
    // The assertion the old test was missing.
    expect(line?.ray).not.toBe(line?.delivery_id);
  });

  it("says nothing about a delivery for a run claimed before the column existed", async () => {
    // `runLogger` binds neither `ray` nor `delivery_id` when `deliveryId` is
    // null, and this line matches it rather than reporting a null id.
    const stale = view("blocked_pending");
    (stale.run as { deliveryId: string | null }).deliveryId = null;
    const { app, logged, runId } = build(stale);
    await approve(app, runId);
    expect(logged("approve.requested")[0]).not.toHaveProperty("delivery_id");
  });
});

describe("approve.rejected", () => {
  it("gives the caller wording and the log a countable reason", async () => {
    const { app, runner, runId } = build(view("clean"));
    (runner as unknown as { approve: () => Promise<unknown> }).approve = async () => ({
      ok: false,
      reason: "not_blocked_pending",
      detail: "run is clean, not blocked_pending",
    });
    const res = await approve(app, runId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    // The UI keeps its sentence; a query gets a word it can count. The 409
    // used to carry four different conditions as one opaque string.
    expect(body.error).toContain("blocked_pending");
    expect(body.reason).toBe("not_blocked_pending");
  });
});

describe("access.denied", () => {
  it("says which check failed, without echoing the assertion", async () => {
    const { app, logged, lines } = build(null);
    const res = await app.fetch(
      new Request("http://cujo.test/runs", {
        headers: { "cf-access-jwt-assertion": "definitely-not-a-jwt" },
      }),
    );
    expect(res.status).toBe(401);
    expect(logged("access.denied")[0]).toMatchObject({ path: "/runs", reason: "no_assertion" });
    // Never the token: on a failed verification nothing in it has been checked,
    // so every claim it carries is attacker-supplied.
    expect(JSON.stringify(lines)).not.toContain("definitely-not-a-jwt");
  });

  it("still answers a bare 401, whatever the reason was", async () => {
    const { app } = build(null);
    const res = await app.fetch(new Request("http://cujo.test/runs"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });
});
