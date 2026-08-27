import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { buildTurnMessage } from "./agent";
import type { GitHubReader } from "./github";
import type { Runner } from "./runner";
import type { Store } from "./store";

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

export interface WebhookDeps {
  secret: string;
  github: GitHubReader;
  store: Store;
  runner: Runner;
  createSession: (repo: string, prNumber: number) => Promise<string>;
  /** False until the harness bootstrap has registered github-mcp. */
  isReady?: () => boolean;
}

/**
 * Contract 1. Answers 202 as soon as the turn is started; the fold runs in the
 * background so GitHub's 10-second delivery timeout is never in play.
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
      // GitHub retries a failed delivery, so refusing now loses nothing.
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

    if (await deps.github.alreadyReviewed(repo, prNumber, headSha)) {
      deps.store.deleteRun(run.id);
      return c.json({ ok: true, ignored: "already reviewed" }, 200);
    }
    const pr = await deps.github.pullRequest(repo, prNumber);
    deps.runner.start(run, buildTurnMessage(pr));
    return c.json({ ok: true, run_id: run.id }, 202);
  });
  return app;
}
