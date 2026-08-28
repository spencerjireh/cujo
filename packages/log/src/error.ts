/**
 * One caught error, turned into fields.
 *
 * `error_kind` is a closed set, so "an expected GitHub 404" and "an unexpected
 * crash" stop looking identical in a log — which was the state of every
 * `console.error(msg, error)` this replaces.
 *
 * The classification is structural, never `instanceof` against an app's error
 * class: this package sits under `apps/cujo`, `apps/github-mcp` and `apps/web`
 * and must not import from any of them. So a status is lifted when it is a
 * number, whoever threw it. `DiscordError` carries `status`, `code` and
 * `retryAfterMs` as fields and is read here for free; `GitHubError` is given
 * the same shape for the same reason.
 *
 * `error_message` is `error.message`, scrubbed and capped — never
 * `String(error)` of a whole object, which is how a serialized error drags a
 * request config and its headers into a log line.
 */

import { CAP, type Fields } from "./fields";
import { scrub } from "./redact";

export type ErrorKind =
  | "http_error"
  | "network_error"
  | "aborted"
  | "timeout"
  | "syntax_error"
  | "error"
  | "non_error";

function numberOf(source: object, key: string): number | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function kindOf(error: Error, status: number | undefined): ErrorKind {
  if (error.name === "AbortError") return "aborted";
  if (error.name === "TimeoutError") return "timeout";
  if (status !== undefined) return "http_error";
  if (error instanceof SyntaxError) return "syntax_error";
  // undici raises `TypeError: fetch failed` with the real reason on `cause`.
  if (error instanceof TypeError && error.cause !== undefined) return "network_error";
  return "error";
}

/**
 * `stack` is included only when the caller asks, which `emit` does only at
 * `debug`. A stack is the largest thing a log line can carry and the least
 * useful one at `info`, where the event name already says where it came from.
 */
export function errorFields(error: unknown, options: { stack?: boolean } = {}): Fields {
  if (!(error instanceof Error)) {
    return {
      error_kind: "non_error",
      error_message: scrub(String(error), CAP.text),
    };
  }
  const status = numberOf(error, "status");
  const code = numberOf(error, "code");
  const retryAfterMs = numberOf(error, "retryAfterMs");
  const fields: Fields = {
    error_kind: kindOf(error, status),
    error_message: scrub(error.message, CAP.text),
  };
  if (status !== undefined) fields.error_status = status;
  if (code !== undefined) fields.error_code = code;
  if (retryAfterMs !== undefined) fields.retry_in_ms = retryAfterMs;
  if (options.stack && error.stack) fields.error_stack = scrub(error.stack, CAP.text);
  return fields;
}
