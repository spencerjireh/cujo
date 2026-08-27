import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AccessVerifier } from "./access";
import type { RunView, Runner } from "./runner";
import type { Store } from "./store";

export interface ApiDeps {
  store: Store;
  runner: Runner;
  verify: AccessVerifier;
}

type Env = { Variables: { email: string } };

function serialize(view: RunView) {
  const { run, projection } = view;
  return {
    id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    session_id: run.sessionId,
    turn_ids: run.turnIds,
    status: run.status,
    approver: run.approver,
    decided_at: run.decidedAt,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    checks: projection.checks,
    findings: projection.findings,
    hard_rule_hits: projection.hardRuleHits,
    review: projection.review,
    approval: run.status === "blocked_pending" ? projection.approval : null,
    external_resume: projection.externalResume,
    error: projection.error,
    summary: projection.summary,
  };
}

/** Contract 6 operator API. Every route requires a verified Access assertion. */
export function apiRoutes(deps: ApiDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const email = await deps.verify(c.req.header("cf-access-jwt-assertion"));
    if (!email) return c.json({ ok: false, error: "unauthorized" }, 401);
    c.set("email", email);
    await next();
  });

  app.get("/runs", (c) => {
    const runs = deps.store.listRuns().map((run) => ({
      id: run.id,
      repo: run.repo,
      pr_number: run.prNumber,
      head_sha: run.headSha,
      status: run.status,
      approver: run.approver,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    }));
    return c.json({ runs });
  });

  app.get("/runs/:id", (c) => {
    const view = deps.runner.view(c.req.param("id"));
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return c.json(serialize(view));
  });

  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const view = deps.runner.view(id);
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return streamSSE(c, async (stream) => {
      let seq = 0;
      const send = (v: RunView) =>
        stream.writeSSE({ event: "run", id: String(seq++), data: JSON.stringify(serialize(v)) });
      // Listen first, then read: an update between the two is delivered
      // twice at worst, never lost.
      const listener = (v: RunView) => void send(v);
      deps.runner.changes.on(id, listener);
      await send(deps.runner.view(id) ?? view);
      const keepalive = setInterval(
        () => void stream.writeSSE({ event: "ping", data: "" }),
        25_000,
      );
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
      clearInterval(keepalive);
      deps.runner.changes.off(id, listener);
    });
  });

  app.post("/runs/:id/approve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== "allow" && body.decision !== "deny") {
      return c.json({ ok: false, error: "decision must be allow or deny" }, 400);
    }
    const result = await deps.runner.approve(c.req.param("id"), body.decision, c.get("email"));
    if (!result.ok) return c.json({ ok: false, error: result.reason }, 409);
    return c.json({ ok: true, decision: body.decision, approver: c.get("email") });
  });

  return app;
}
