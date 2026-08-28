import { describe, expect, it } from "vitest";
import { errorFields } from "../src/error";
import { REDACTED } from "../src/redact";

/** The shape `DiscordError` already has, and `GitHubError` is given. */
const httpError = (message: string, extra: Record<string, unknown>) =>
  Object.assign(new Error(message), extra);

describe("errorFields", () => {
  it("classifies an error carrying a status as http_error and lifts the status", () => {
    const fields = errorFields(httpError("channel is gone", { status: 404, code: 10003 }));
    expect(fields.error_kind).toBe("http_error");
    expect(fields.error_status).toBe(404);
    expect(fields.error_code).toBe(10003);
  });

  it("lifts a Discord retry hint", () => {
    const fields = errorFields(httpError("rate limited", { status: 429, retryAfterMs: 1500 }));
    expect(fields.retry_in_ms).toBe(1500);
  });

  it("names an abort, a timeout, and a bad payload distinctly", () => {
    expect(errorFields(Object.assign(new Error("x"), { name: "AbortError" })).error_kind).toBe(
      "aborted",
    );
    expect(errorFields(Object.assign(new Error("x"), { name: "TimeoutError" })).error_kind).toBe(
      "timeout",
    );
    expect(errorFields(new SyntaxError("Unexpected token")).error_kind).toBe("syntax_error");
  });

  it("recognises a failed fetch by its cause", () => {
    const failed = new TypeError("fetch failed");
    failed.cause = new Error("ECONNREFUSED");
    expect(errorFields(failed).error_kind).toBe("network_error");
    // A plain TypeError is a bug, not a network problem.
    expect(errorFields(new TypeError("x is not a function")).error_kind).toBe("error");
  });

  it("survives a thrown non-error without throwing itself", () => {
    expect(errorFields("just a string").error_kind).toBe("non_error");
    expect(errorFields(undefined).error_kind).toBe("non_error");
    expect(errorFields({ nope: true }).error_kind).toBe("non_error");
  });

  it("survives a value whose own toString throws", () => {
    // The coercion runs code the thrower chose. Callers build these fields
    // before calling a log method, so emit's guard is not yet in scope: an
    // unguarded read would replace the original failure with a second one.
    const hostile = {
      toString() {
        throw new Error("nice try");
      },
    };
    expect(() => errorFields(hostile)).not.toThrow();
    expect(errorFields(hostile).error_message).toBe("[unprintable value]");
  });

  it("survives an Error whose message, name and status are throwing getters", () => {
    const hostile = Object.create(Error.prototype, {
      message: {
        get() {
          throw new Error("no message for you");
        },
      },
      name: {
        get() {
          throw new Error("no name either");
        },
      },
      status: {
        get() {
          throw new Error("nor a status");
        },
      },
    }) as Error;
    expect(() => errorFields(hostile, { stack: true })).not.toThrow();
    expect(errorFields(hostile).error_kind).toBe("non_error");
  });

  it("ignores a non-numeric code, so a Node system error does not fake a status", () => {
    const fields = errorFields(httpError("no such file", { code: "ENOENT" }));
    expect(fields.error_kind).toBe("error");
    expect(fields.error_code).toBeUndefined();
    expect(fields.error_status).toBeUndefined();
  });

  it("scrubs the message, because an upstream body reaches it", () => {
    // Assembled, not written out, for the reason redact.test.ts explains: a
    // credential-shaped literal in the source is a blocked push, and this is
    // exactly the case github-mcp produced by interpolating a response body.
    const token = ["ghs", "_", "0123456789abcdef0123456789abcdef0123"].join("");
    const leaky = new Error(`GitHub POST failed: 401 {"token":"${token}"}`);
    expect(errorFields(leaky).error_message).toContain(REDACTED);
    expect(errorFields(leaky).error_message).not.toContain(token.slice(0, 12));
  });

  it("withholds the stack unless it is asked for", () => {
    const error = new Error("boom");
    expect(errorFields(error).error_stack).toBeUndefined();
    expect(errorFields(error, { stack: true }).error_stack).toContain("boom");
  });
});
