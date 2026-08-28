/**
 * The GitHub webhook (spec Contract 1). Reachable from the internet, and the
 * HMAC on the raw body is the only thing standing between it and anyone —
 * GitHub cannot solve a Cloudflare Access challenge, so this route lives on
 * the webhook host rather than behind Access (decision 7).
 *
 * Its job ends when the run row is claimed. Everything after that is
 * `review/start-run.ts`, running in the background so GitHub's ten-second
 * delivery timeout is never in play.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { type StartRunDeps, startRun } from "../../review/start-run";
import type { RunStore } from "../../store";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** X-Hub-Signature-256 check, constant time. */
export function verifySignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length);
  // A same-length non-hex string would decode to a shorter buffer and make
  // timingSafeEqual throw; reject it outright instead.
  if (!HEX_SHA256.test(given)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

interface PullRequestEvent {
  action: string;
  number: number;
  repository: { full_name: string };
  pull_request: { head: { sha: string } };
}

export interface WebhookDeps extends StartRunDeps {
  secret: string;
  store: RunStore;
  createSession: (repo: string, prNumber: number) => Promise<string>;
  /** False until the harness bootstrap has completed every registration. */
  isReady?: () => boolean;
}

/**
 * Contract 1. Answers 202 as soon as the run is claimed; the GitHub reads,
 * the turn start, and the fold all happen after the response.
 */
export function webhookRoutes(deps: WebhookDeps): Hono {
  const app = new Hono();
  app.post("/webhook", async (c) => {
    const body = await c.req.text();
    if (!verifySignature(deps.secret, body, c.req.header("x-hub-signature-256"))) {
      return c.json({ ok: false, error: "bad signature" }, 401);
    }
    if (c.req.header("x-github-event") !== "pull_request") {
      return c.json({ ok: true, ignored: "event" }, 200);
    }
    const event = JSON.parse(body) as PullRequestEvent;
    if (event.action !== "opened" && event.action !== "synchronize") {
      return c.json({ ok: true, ignored: "action" }, 200);
    }
    if (deps.isReady && !deps.isReady()) {
      // GitHub does not retry on its own, but a 503 shows in the delivery
      // log and the head is claimed by nothing, so a redelivery works.
      return c.json({ ok: false, error: "harness not ready" }, 503);
    }
    const repo = event.repository.full_name;
    const prNumber = event.number;
    const headSha = event.pull_request.head.sha;

    // Find or create the session first, so the run row can be claimed before
    // any slow GitHub call: two concurrent deliveries then agree on one
    // session and exactly one of them owns the run.
    let sessionId = deps.store.getSession(repo, prNumber);
    if (!sessionId) {
      sessionId = deps.store.putSession(repo, prNumber, await deps.createSession(repo, prNumber));
    }
    const { run, created } = deps.store.createRun({ repo, prNumber, headSha, sessionId });
    if (!created) {
      return c.json({ ok: true, ignored: "duplicate delivery", run_id: run.id }, 200);
    }
    void startRun(deps, run);
    return c.json({ ok: true, run_id: run.id }, 202);
  });
  return app;
}
