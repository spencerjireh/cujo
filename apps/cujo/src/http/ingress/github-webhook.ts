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
import { type Context, Hono } from "hono";
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
  /**
   * `private` is optional so the read below has to be an explicit `=== false`.
   * A missing field then means "not known to be public", which is the safe
   * reading; `!private` would call it public (decision 34).
   */
  repository: { full_name: string; private?: boolean };
  pull_request: { head: { sha: string } };
}

export interface WebhookDeps extends StartRunDeps {
  secret: string;
  store: RunStore;
  createSession: (repo: string, prNumber: number) => Promise<string>;
  /** False until the harness bootstrap has completed every registration. */
  isReady?: () => boolean;
}

interface RepositoryEvent {
  action: string;
  repository: { full_name: string };
}

/**
 * A repo changed visibility (decision 34). This is the fast path: the public
 * board drops a repo within seconds of it going private, where the periodic
 * sweep in `review/visibility.service.ts` would take up to its interval.
 *
 * Both actions matter. `privatized` is the one that protects something;
 * `publicized` is what lets a repo appear without waiting for the sweep.
 */
function handleRepository(deps: WebhookDeps, c: Context, body: string): Response {
  const event = JSON.parse(body) as RepositoryEvent;
  if (event.action !== "privatized" && event.action !== "publicized") {
    return c.json({ ok: true, ignored: "action" }, 200);
  }
  const isPublic = event.action === "publicized";
  const changed = deps.store.setRepoVisibility(event.repository.full_name, isPublic);
  console.info(
    `webhook: ${event.repository.full_name} visibility → ${isPublic ? "public" : "private"} (${changed} runs restamped)`,
  );
  return c.json({ ok: true, repo: event.repository.full_name, is_public: isPublic, changed }, 200);
}

/**
 * Contract 1. Answers 202 as soon as the run is claimed; the GitHub reads,
 * the turn start, and the fold all happen after the response.
 */
export function webhookRoutes(deps: WebhookDeps): Hono {
  const app = new Hono();
  app.post("/webhook", async (c) => {
    const body = await c.req.text();
    // The signature is checked before the event type, and for every event: it
    // is the only gate this route has, and it is what makes a `repository`
    // delivery as trustworthy as a `pull_request` one.
    if (!verifySignature(deps.secret, body, c.req.header("x-hub-signature-256"))) {
      console.info("webhook: bad signature");
      return c.json({ ok: false, error: "bad signature" }, 401);
    }
    const eventType = c.req.header("x-github-event");
    if (eventType === "repository") return handleRepository(deps, c, body);
    if (eventType !== "pull_request") {
      return c.json({ ok: true, ignored: "event" }, 200);
    }
    const event = JSON.parse(body) as PullRequestEvent;
    if (event.action !== "opened" && event.action !== "synchronize") {
      return c.json({ ok: true, ignored: "action" }, 200);
    }
    const repo = event.repository.full_name;
    const prNumber = event.number;
    const headSha = event.pull_request.head.sha;
    if (deps.isReady && !deps.isReady()) {
      // GitHub does not retry on its own, but a 503 shows in the delivery
      // log and the head is claimed by nothing, so a redelivery works.
      console.info(`webhook: 503, harness not ready (${repo} #${prNumber})`);
      return c.json({ ok: false, error: "harness not ready" }, 503);
    }

    // Find or create the session first, so the run row can be claimed before
    // any slow GitHub call: two concurrent deliveries then agree on one
    // session and exactly one of them owns the run.
    let sessionId = deps.store.getSession(repo, prNumber);
    if (!sessionId) {
      sessionId = deps.store.putSession(repo, prNumber, await deps.createSession(repo, prNumber));
      console.info(`webhook: new session ${sessionId} for ${repo} #${prNumber}`);
    }
    const { run, created } = deps.store.createRun({
      repo,
      prNumber,
      headSha,
      sessionId,
      isPublic: event.repository.private === false,
    });
    if (!created) {
      console.info(
        `webhook: duplicate delivery for ${repo} #${prNumber} sha=${headSha.slice(0, 7)}, run ${run.id}`,
      );
      return c.json({ ok: true, ignored: "duplicate delivery", run_id: run.id }, 200);
    }
    console.info(
      `webhook: run ${run.id} created for ${repo} #${prNumber} sha=${headSha.slice(0, 7)}`,
    );
    void startRun(deps, run);
    return c.json({ ok: true, run_id: run.id }, 202);
  });
  return app;
}
