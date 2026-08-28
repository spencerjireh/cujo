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
import type { Logger } from "@cujo/log";
import { type Context, Hono } from "hono";
import { type StartRunDeps, startRun } from "../../review/start-run";
import type { RunStore } from "../../store";
import type { RequestEnv } from "../request-log";

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
function handleRepository(
  deps: WebhookDeps,
  c: Context<RequestEnv>,
  body: string,
  // Passed in rather than read from the context: the delivery-scoped child is
  // built in the route, and reaching for `c.get("log")` here would silently
  // drop `delivery_id` and `cf_ray` from every repository event.
  log: Logger,
): Response {
  const event = JSON.parse(body) as RepositoryEvent;
  if (event.action !== "privatized" && event.action !== "publicized") {
    log.debug("webhook.ignored", {
      event_type: "repository",
      action: event.action,
      reason: "action",
    });
    return c.json({ ok: true, ignored: "action" }, 200);
  }
  const isPublic = event.action === "publicized";
  const changed = deps.store.setRepoVisibility(event.repository.full_name, isPublic);
  log.info("repo.visibility.changed", {
    repo: event.repository.full_name,
    is_public: isPublic,
    runs_restamped: changed,
  });
  return c.json({ ok: true, repo: event.repository.full_name, is_public: isPublic, changed }, 200);
}

/**
 * Contract 1. Answers 202 as soon as the run is claimed; the GitHub reads,
 * the turn start, and the fold all happen after the response.
 */
export function webhookRoutes(deps: WebhookDeps): Hono<RequestEnv> {
  const app = new Hono<RequestEnv>();
  app.post("/webhook", async (c) => {
    const body = await c.req.text();
    // Read before the signature check, because the 401 line has nothing else
    // to identify itself by. That makes it attacker-controlled on that one
    // path, so it is capped and scrubbed like any free text by the logger,
    // and it is never used as a store key or interpolated into a path. On a
    // rejected delivery it is a hint; on an accepted one it is a fact.
    const deliveryId = c.req.header("x-github-delivery") ?? null;
    // The delivery id wins over the edge ray on this plane: it is the value
    // you paste into GitHub's delivery log and redeliver from. The edge id is
    // kept beside it rather than overwritten — they identify different things,
    // and this is the only route where both exist.
    const log = deliveryId
      ? c.get("log").child({ ray: deliveryId, cf_ray: c.get("ray"), delivery_id: deliveryId })
      : c.get("log");

    // The signature is checked before the event type, and for every event: it
    // is the only gate this route has, and it is what makes a `repository`
    // delivery as trustworthy as a `pull_request` one.
    if (!verifySignature(deps.secret, body, c.req.header("x-hub-signature-256"))) {
      // Nothing is parsed yet, so this line carries no repo and no PR. That
      // absence is the point: an unsigned body is not evidence of anything.
      log.warn("webhook.rejected", { reason: "bad_signature" });
      return c.json({ ok: false, error: "bad signature" }, 401);
    }
    const eventType = c.req.header("x-github-event");
    if (eventType === "repository") return handleRepository(deps, c, body, log);
    if (eventType !== "pull_request") {
      // `debug`, because the App is subscribed to events it does not act on
      // and this is the branch that would otherwise dominate the log.
      log.debug("webhook.ignored", { event_type: eventType ?? "", reason: "event" });
      return c.json({ ok: true, ignored: "event" }, 200);
    }
    const event = JSON.parse(body) as PullRequestEvent;
    const repo = event.repository.full_name;
    const prNumber = event.number;
    const headSha = event.pull_request.head.sha;
    if (event.action !== "opened" && event.action !== "synchronize") {
      log.debug("webhook.ignored", {
        event_type: "pull_request",
        action: event.action,
        reason: "action",
        repo,
        pr_number: prNumber,
      });
      return c.json({ ok: true, ignored: "action" }, 200);
    }
    if (deps.isReady && !deps.isReady()) {
      // GitHub does not retry on its own, but a 503 shows in the delivery
      // log and the head is claimed by nothing, so a redelivery works.
      // `warn`, not `debug`: this is a review that did not happen.
      log.warn("webhook.deferred", {
        repo,
        pr_number: prNumber,
        head_sha: headSha,
        reason: "harness_not_ready",
      });
      return c.json({ ok: false, error: "harness not ready" }, 503);
    }

    // Find or create the session first, so the run row can be claimed before
    // any slow GitHub call: two concurrent deliveries then agree on one
    // session and exactly one of them owns the run.
    let sessionId = deps.store.getSession(repo, prNumber);
    const sessionCreated = !sessionId;
    if (!sessionId) {
      sessionId = deps.store.putSession(repo, prNumber, await deps.createSession(repo, prNumber));
    }
    const { run, created } = deps.store.createRun({
      repo,
      prNumber,
      headSha,
      sessionId,
      isPublic: event.repository.private === false,
      deliveryId,
    });
    if (!created) {
      log.info("webhook.ignored", {
        event_type: "pull_request",
        action: event.action,
        reason: "duplicate_delivery",
        repo,
        pr_number: prNumber,
        head_sha: headSha,
        run_id: run.id,
      });
      return c.json({ ok: true, ignored: "duplicate delivery", run_id: run.id }, 200);
    }
    // The head of the audit trail: the one line that joins a delivery id to a
    // run id, and the reason a query can start from either.
    log.info("webhook.accepted", {
      repo,
      pr_number: prNumber,
      head_sha: headSha,
      run_id: run.id,
      session_id: sessionId,
      session_created: sessionCreated,
      is_public: event.repository.private === false,
    });
    void startRun(deps, run);
    return c.json({ ok: true, run_id: run.id }, 202);
  });
  return app;
}
