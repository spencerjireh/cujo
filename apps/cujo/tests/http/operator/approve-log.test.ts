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

const approve = (app: Hono<Env>, body = "allow") =>
  app.fetch(
    new Request("http://cujo.test/runs/r1/approve", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ decision: body }),
    }),
  );

describe("approve.requested", () => {
  it("names the operator, the decision and the run before the outcome is known", async () => {
    const { app, logged } = build(view("blocked_pending"));
    await approve(app);
    expect(logged("approve.requested")[0]).toMatchObject({
      run_id: "r1",
      decision: "allow",
      actor: "op@example.com",
    });
  });

  it("carries the operator's own request ray, distinct from the run's", async () => {
    // Two facts: which delivery started the run, and which request decided it.
    const { app, logged } = build(view("blocked_pending"));
    await app.fetch(
      new Request("http://cujo.test/runs/r1/approve", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json", "cf-ray": "operator-ray" },
        body: JSON.stringify({ decision: "deny" }),
      }),
    );
    expect(logged("approve.requested")[0]).toMatchObject({
      request_ray: "operator-ray",
      decision: "deny",
    });
  });
});

describe("approve.rejected", () => {
  it("gives the caller wording and the log a countable reason", async () => {
    const { app, runner } = build(view("clean"));
    (runner as unknown as { approve: () => Promise<unknown> }).approve = async () => ({
      ok: false,
      reason: "not_blocked_pending",
      detail: "run is clean, not blocked_pending",
    });
    const res = await approve(app);
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
