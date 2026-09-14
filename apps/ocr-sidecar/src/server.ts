/**
 * HTTP surface: `/healthz` for the container healthcheck and `POST /review`
 * for `apps/cujo`. One review at a time — a second request while one runs is
 * 429, not a queue, because the caller fires and forgets and a queue here
 * would only hide how long the box was busy.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type Logger, createLogger } from "@cujo/log";
import { ReviewRequest, checkCloneUrl } from "./request";
import type { Reviewer } from "./review";

export interface AppOptions {
  review: Reviewer;
  log?: Logger;
  /** Bytes of request body accepted; a title and a body fit in far less. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 256 * 1024;

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
  let busy = false;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "ocr-sidecar" });
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
    if (busy) {
      log.warn("ocr.request.refused", {
        reason: "busy",
        repo: parsed.repo,
        pr_number: parsed.prNumber,
      });
      json(res, 429, { ok: false, error: "busy" });
      return;
    }
    busy = true;
    try {
      const outcome = await options.review(parsed);
      const fields = {
        repo: parsed.repo,
        pr_number: parsed.prNumber,
        head_sha: parsed.headSha,
        duration_ms: outcome.durationMs,
      };
      if (outcome.ok) {
        log.info("ocr.run.finished", {
          ...fields,
          count: commentCount(outcome.result),
          ...(outcome.exitCode !== null ? { error_code: outcome.exitCode } : {}),
        });
      } else {
        log.warn("ocr.run.failed", {
          ...fields,
          error_message: outcome.error,
          ...(typeof outcome.exitCode === "number" ? { error_code: outcome.exitCode } : {}),
        });
      }
      json(res, 200, outcome);
    } finally {
      busy = false;
    }
  });
}

function commentCount(result: unknown): number {
  if (result && typeof result === "object" && "comments" in result) {
    const comments = (result as { comments?: unknown }).comments;
    return Array.isArray(comments) ? comments.length : 0;
  }
  return 0;
}
