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
import { type Logger, errorFields } from "@cujo/log";
import { type Context, Hono } from "hono";
import type { ConverseService } from "../../converse/converse.service";
import type { PrCommandService } from "../../review/pr-command.service";
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
  /** Absent means `/cujo` on a pull request is off; deliveries are still 200. */
  prCommands?: Pick<PrCommandService, "handle">;
  /** Absent means `@cujo-guard` is off; deliveries are still 200. */
  converse?: Pick<ConverseService, "handle">;
}

interface IssueCommentEvent {
  action: string;
  repository: { full_name: string };
  issue: {
    number: number;
    /**
     * Present only when the issue is a pull request. `issue_comment` fires for
     * both, and Cujo reviews neither issues nor their comments.
     */
    pull_request?: unknown;
  };
  comment: { id: number; body: string; user: { login: string } | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The payload, or null if it is not the shape GitHub documents.
 *
 * A cast is a claim about a stranger's JSON, and this is the one route that
 * turns a stranger's JSON into a decision on a review. Every field the handler
 * or the command service reads is checked here, once, so nothing downstream
 * touches a property of something that might be a number. `user` is nullable
 * for real — a deleted account — and stays that way.
 */
function parseIssueComment(body: string): IssueCommentEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { action, repository, issue, comment } = raw;
  if (typeof action !== "string") return null;
  if (!isRecord(repository) || typeof repository.full_name !== "string") return null;
  if (!isRecord(issue) || typeof issue.number !== "number") return null;
  if (!isRecord(comment) || typeof comment.id !== "number" || typeof comment.body !== "string") {
    return null;
  }
  const user = comment.user;
  if (user !== null && user !== undefined && !(isRecord(user) && typeof user.login === "string")) {
    return null;
  }
  return {
    action,
    repository: { full_name: repository.full_name },
    issue: { number: issue.number, pull_request: issue.pull_request },
    comment: {
      id: comment.id,
      body: comment.body,
      user: isRecord(user) && typeof user.login === "string" ? { login: user.login } : null,
    },
  };
}

/**
 * A comment on a pull request, which may be a `/cujo` command (Design 2).
 *
 * The signature was already checked, above and before the event type, and that
 * is what makes this plane trustworthy enough to decide a review on — the same
 * argument the `repository` event rests on. Decision 44 has the rest.
 *
 * Answers 200 immediately and does the work after, like the pull request path:
 * the command needs two GitHub reads and a resume, and GitHub's delivery
 * timeout is ten seconds.
 */
function handleIssueComment(
  deps: WebhookDeps,
  c: Context<RequestEnv>,
  body: string,
  log: Logger,
): Response {
  const event = parseIssueComment(body);
  if (!event) {
    log.debug("webhook.ignored", { event_type: "issue_comment", reason: "malformed" });
    return c.json({ ok: true, ignored: "malformed" }, 200);
  }
  // `edited` and `deleted` are deliberately not acted on. A command that can be
  // typed into an existing comment is a command whose author is not the person
  // the payload names at the time it fires.
  if (event.action !== "created") {
    log.debug("webhook.ignored", {
      event_type: "issue_comment",
      action: event.action,
      reason: "action",
    });
    return c.json({ ok: true, ignored: "action" }, 200);
  }
  if (!event.issue.pull_request) {
    log.debug("webhook.ignored", { event_type: "issue_comment", reason: "not_a_pull_request" });
    return c.json({ ok: true, ignored: "issue" }, 200);
  }
  if (!deps.prCommands && !deps.converse) {
    log.debug("webhook.ignored", { event_type: "issue_comment", reason: "not_configured" });
    return c.json({ ok: true, ignored: "not_configured" }, 200);
  }

  // Both, and each ignores what is not its shape. A comment is a command or a
  // question and never both — the two syntaxes were chosen to be unmistakable
  // for each other — so dispatching to both costs one parse and keeps the
  // question of which one it was where it belongs, in the service that owns
  // the syntax.
  const comment = {
    repo: event.repository.full_name,
    prNumber: event.issue.number,
    commentId: event.comment.id,
    actor: event.comment.user?.login ?? "",
    body: event.comment.body,
    log,
  };
  // `handle` is built never to throw — every outcome speaks on the pull
  // request — but the delivery is already answered by the time it runs, so an
  // unhandled rejection here would be a person waiting on a reply that never
  // comes, with nothing in the log to say why.
  void deps.prCommands?.handle(comment).catch((error: unknown) => {
    log.error("comment.command.failed", {
      repo: comment.repo,
      pr_number: comment.prNumber,
      error_kind: error instanceof Error ? error.name : "unknown",
    });
  });
  void deps.converse?.handle({ ...comment, surface: { kind: "issue" } }).catch((error: unknown) => {
    log.error("converse.failed", {
      repo: comment.repo,
      pr_number: comment.prNumber,
      error_kind: error instanceof Error ? error.name : "unknown",
    });
  });
  return c.json({ ok: true, accepted: "comment" }, 200);
}

/**
 * A reply inside a review thread — the comments hanging off one line of the
 * diff, where Cujo's own inline findings are.
 *
 * A separate GitHub event from `issue_comment`, and the one flow C actually
 * needs: "prove it" is asked under the finding it doubts, not at the bottom of
 * the page. Only conversation is dispatched here. A privileged `/cujo` verb
 * stays on the pull request's own thread, where it is about the run rather than
 * about one line, and narrowing the surface that can decide a review is free.
 */
function handleReviewComment(
  deps: WebhookDeps,
  c: Context<RequestEnv>,
  body: string,
  log: Logger,
): Response {
  const event = parseReviewComment(body);
  if (!event) {
    log.debug("webhook.ignored", {
      event_type: "pull_request_review_comment",
      reason: "malformed",
    });
    return c.json({ ok: true, ignored: "malformed" }, 200);
  }
  if (event.action !== "created") {
    log.debug("webhook.ignored", {
      event_type: "pull_request_review_comment",
      action: event.action,
      reason: "action",
    });
    return c.json({ ok: true, ignored: "action" }, 200);
  }
  if (!deps.converse) {
    log.debug("webhook.ignored", {
      event_type: "pull_request_review_comment",
      reason: "not_configured",
    });
    return c.json({ ok: true, ignored: "not_configured" }, 200);
  }
  void deps.converse
    .handle({
      repo: event.repository.full_name,
      prNumber: event.pull_request.number,
      commentId: event.comment.id,
      actor: event.comment.user?.login ?? "",
      body: event.comment.body,
      surface: { kind: "review_thread", commentId: event.comment.id },
      log,
    })
    .catch((error: unknown) => {
      log.error("converse.failed", {
        repo: event.repository.full_name,
        pr_number: event.pull_request.number,
        error_kind: error instanceof Error ? error.name : "unknown",
      });
    });
  return c.json({ ok: true, accepted: "review_comment" }, 200);
}

interface ReviewCommentEvent {
  action: string;
  repository: { full_name: string };
  pull_request: { number: number };
  comment: { id: number; body: string; user: { login: string } | null };
}

/** The same boundary check `parseIssueComment` makes, for the other shape. */
function parseReviewComment(body: string): ReviewCommentEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { action, repository, pull_request: pull, comment } = raw;
  if (typeof action !== "string") return null;
  if (!isRecord(repository) || typeof repository.full_name !== "string") return null;
  if (!isRecord(pull) || typeof pull.number !== "number") return null;
  if (!isRecord(comment) || typeof comment.id !== "number" || typeof comment.body !== "string") {
    return null;
  }
  const user = comment.user;
  if (user !== null && user !== undefined && !(isRecord(user) && typeof user.login === "string")) {
    return null;
  }
  return {
    action,
    repository: { full_name: repository.full_name },
    pull_request: { number: pull.number },
    comment: {
      id: comment.id,
      body: comment.body,
      user: isRecord(user) && typeof user.login === "string" ? { login: user.login } : null,
    },
  };
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
    if (eventType === "issue_comment") return handleIssueComment(deps, c, body, log);
    if (eventType === "pull_request_review_comment") {
      return handleReviewComment(deps, c, body, log);
    }
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
      // Guarded because this is the one call here that reaches another
      // service. Unguarded it escaped the handler, and the only record was a
      // stack trace on stderr carrying the whole TrueForge response body:
      // unstructured, unqueryable, and the one thing the standard says never
      // to put in a message. A 502 also tells the truth a 500 did not — the
      // failure is upstream, and a redelivery is worth trying.
      let created: string;
      try {
        created = await deps.createSession(repo, prNumber);
      } catch (error) {
        log.error("webhook.failed", {
          repo,
          pr_number: prNumber,
          head_sha: headSha,
          reason: "session_create_failed",
          ...errorFields(error),
        });
        return c.json({ ok: false, error: "could not start a session" }, 502);
      }
      sessionId = deps.store.putSession(repo, prNumber, created);
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
