/**
 * The run API (spec Contract 6): what the operator UI reads, and the one thing
 * it writes — approve or reject a blocked review.
 *
 * Mounted behind the Access gate in `index.ts`, so every handler here can
 * assume a verified email and the approve route records it as the approver.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunView, Runner } from "../../review/runner.service";
import type { RunStore } from "../../store";
import type { Env } from "./access";

export interface RunRoutesDeps {
  runs: RunStore;
  runner: Runner;
}

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
    pr_title: run.prTitle,
    pr_author_login: run.prAuthorLogin,
    pr_author_id: run.prAuthorId,
    checks: projection.checks,
    findings: projection.findings,
    hard_rule_hits: projection.hardRuleHits,
    review: projection.review,
    // Unconditional, unlike the public plane's copy. This is the surface where
    // a human reads what they are being asked to confirm, so it has to show
    // the accusation before it is published, not after.
    gated_review: projection.gatedReview ?? null,
    approval: run.status === "blocked_pending" ? projection.approval : null,
    external_resume: projection.externalResume,
    error: projection.error,
    summary: projection.summary,
  };
}

export function runRoutes(deps: RunRoutesDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/runs", (c) => {
    const runs = deps.runs.listRuns().map((run) => ({
      id: run.id,
      repo: run.repo,
      pr_number: run.prNumber,
      head_sha: run.headSha,
      status: run.status,
      approver: run.approver,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
      pr_title: run.prTitle,
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

  return app;
}
