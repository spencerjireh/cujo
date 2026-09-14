/**
 * HTTP surface: `/healthz` for the container healthcheck, `POST /review` to
 * start a review for `apps/cujo`, and `GET /review/:id` to collect it.
 *
 * Two calls and not one, because a review is minutes and a single HTTP
 * response is not: Node's fetch gives up waiting for response headers after
 * five minutes whatever the caller's own timeout says, and the first shadow
 * reviews that ran longer than that came back to `apps/cujo` as `fetch
 * failed` while the sidecar was still working. So the start answers at once
 * with an id, and the caller polls. One review at a time — a second start
 * while one runs is 429, not a queue, because the caller fires and forgets
 * and a queue here would only hide how long the box was busy. Outcomes are
 * kept in memory for an hour, which is longer than any caller waits.
 */

import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type Logger, createLogger } from "@cujo/log";
import { ReviewRequest, checkCloneUrl } from "./request";
import type { ReviewOutcome, Reviewer } from "./review";

export interface AppOptions {
  /** Null when the deploy carries no model settings: healthy, and refusing. */
  review: Reviewer | null;
  log?: Logger;
  /** Bytes of request body accepted; a title and a body fit in far less. */
  maxBodyBytes?: number;
  /** How long a finished outcome stays collectable. */
  retainMs?: number;
}

/** What `GET /review/:id` answers. */
export type ReviewJobState =
  | { id: string; state: "running" }
  | { id: string; state: "done"; outcome: ReviewOutcome };

const DEFAULT_MAX_BODY = 256 * 1024;
const DEFAULT_RETAIN_MS = 60 * 60 * 1000;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, cap: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > cap) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createApp(options: AppOptions) {
  const log = options.log ?? createLogger({ service: "ocr-sidecar" });
  const cap = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const retainMs = options.retainMs ?? DEFAULT_RETAIN_MS;
  const jobs = new Map<string, { state: ReviewJobState; finishedAt: number | null }>();
  let busy = false;

  const sweep = () => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > retainMs) jobs.delete(id);
    }
  };

  const start = (review: Reviewer, parsed: ReviewRequest): string => {
    const id = randomUUID();
    jobs.set(id, { state: { id, state: "running" }, finishedAt: null });
    busy = true;
    const fields = { repo: parsed.repo, pr_number: parsed.prNumber, head_sha: parsed.headSha };
    void review(parsed)
      .then(
        (outcome) => outcome,
        (error): ReviewOutcome => ({
          ok: false,
          error: error instanceof Error ? error.message : "review failed",
          durationMs: 0,
        }),
      )
      .then((outcome) => {
        busy = false;
        jobs.set(id, { state: { id, state: "done", outcome }, finishedAt: Date.now() });
        if (outcome.ok) {
          log.info("ocr.run.finished", {
            ...fields,
            duration_ms: outcome.durationMs,
            count: commentCount(outcome.result),
            ...(outcome.exitCode !== null ? { error_code: outcome.exitCode } : {}),
          });
        } else {
          log.warn("ocr.run.failed", {
            ...fields,
            duration_ms: outcome.durationMs,
            error_message: outcome.error,
            ...(typeof outcome.exitCode === "number" ? { error_code: outcome.exitCode } : {}),
          });
        }
        sweep();
      });
    return id;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "ocr-sidecar" });
      return;
    }
    const collect = /^\/review\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (collect && req.method === "GET") {
      const job = jobs.get(collect[1] ?? "");
      if (!job) {
        json(res, 404, { ok: false, error: "no such review" });
        return;
      }
      json(res, 200, job.state);
      return;
    }
    if (url.pathname !== "/review" || req.method !== "POST") {
      json(res, 404, { ok: false });
      return;
    }
    const text = await readBody(req, cap);
    if (text === null) {
      log.warn("ocr.request.refused", { reason: "body_too_large" });
      json(res, 413, { ok: false, error: "body too large" });
      return;
    }
    let parsed: ReviewRequest;
    try {
      parsed = ReviewRequest.parse(JSON.parse(text));
    } catch (error) {
      log.warn("ocr.request.refused", { reason: "invalid" });
      json(res, 400, { ok: false, error: error instanceof Error ? error.message : "invalid" });
      return;
    }
    const refusal = checkCloneUrl(parsed.cloneUrl, parsed.repo);
    if (refusal) {
      log.warn("ocr.request.refused", {
        reason: "clone_url",
        repo: parsed.repo,
        pr_number: parsed.prNumber,
      });
      json(res, 400, { ok: false, error: refusal });
      return;
    }
    if (!options.review) {
      log.warn("ocr.request.refused", {
        reason: "unconfigured",
        repo: parsed.repo,
        pr_number: parsed.prNumber,
      });
      json(res, 503, { ok: false, error: "sidecar has no model configured" });
      return;
    }
    if (busy) {
      log.warn("ocr.request.refused", {
        reason: "busy",
        repo: parsed.repo,
        pr_number: parsed.prNumber,
      });
      json(res, 429, { ok: false, error: "busy" });
      return;
    }
    const id = start(options.review, parsed);
    json(res, 202, { ok: true, id });
  });
}

function commentCount(result: unknown): number {
  if (result && typeof result === "object" && "comments" in result) {
    const comments = (result as { comments?: unknown }).comments;
    return Array.isArray(comments) ? comments.length : 0;
  }
  return 0;
}
