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
 * Reads and coerces one value without trusting it.
 *
 * `String(x)` runs `x`'s own `toString`, and reaching `.message` runs its own
 * getter — for a thrown object both are code the thrower chose, and either may
 * throw. Callers build these fields *before* calling a log method, so `emit`'s
 * guard is not yet in scope: an unguarded read here would replace the original
 * failure with a second one raised at the point meant to report it. The thunk
 * is what puts the property access inside the guard too.
 */
function safely(read: () => unknown): string {
  try {
    return String(read());
  } catch {
    return "[unprintable value]";
  }
}

/**
 * Total by construction.
 *
 * `safely` covers the two reads most likely to be hostile, but `kindOf` reaches
 * `name` and `cause` and `numberOf` reaches `status` — every one a property
 * access that a crafted object can turn into a throw. Guarding each in turn
 * would be a list somebody has to remember to extend; wrapping the whole
 * derivation is a rule that cannot be forgotten. The fallback still names the
 * failure rather than losing it.
 *
 * `stack` is included only when the caller asks, which `emit` does only at
 * `debug`. A stack is the largest thing a log line can carry and the least
 * useful one at `info`, where the event name already says where it came from.
 */
export function errorFields(error: unknown, options: { stack?: boolean } = {}): Fields {
  try {
    return derive(error, options);
  } catch {
    return { error_kind: "non_error", error_message: "[unprintable value]" };
  }
}

function derive(error: unknown, options: { stack?: boolean }): Fields {
  if (!(error instanceof Error)) {
    return {
      error_kind: "non_error",
      error_message: scrub(
        safely(() => error),
        CAP.text,
      ),
    };
  }
  const status = numberOf(error, "status");
  const code = numberOf(error, "code");
  const retryAfterMs = numberOf(error, "retryAfterMs");
  const fields: Fields = {
    error_kind: kindOf(error, status),
    error_message: scrub(
      safely(() => error.message),
      CAP.text,
    ),
  };
  if (status !== undefined) fields.error_status = status;
  if (code !== undefined) fields.error_code = code;
  if (retryAfterMs !== undefined) fields.retry_in_ms = retryAfterMs;
  if (options.stack) {
    const stack = safely(() => error.stack ?? "");
    if (stack) fields.error_stack = scrub(stack, CAP.text);
  }
  return fields;
}
