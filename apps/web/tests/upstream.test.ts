/**
 * The decisions the proxy routes make about a failure, tested where they are
 * testable: the handlers themselves `await headers()`, which throws outside a
 * request scope, so the judgement lives in pure functions and the handlers
 * stay thin enough to read.
 */

import { refusalFields, streamOutcome, streamStatus } from "@/lib/api/upstream";
import { describe, expect, it } from "vitest";

describe("refusalFields", () => {
  it("names the path the caller asked for, not the one it was rewritten to", () => {
    expect(refusalFields(["runs", "abc", "events"], "operator", "events_path")).toEqual({
      path: "/runs/abc/events",
      mode: "operator",
      reason: "events_path",
    });
  });

  it("distinguishes the two refusals, which have different causes", () => {
    // One is a client using the wrong route for a stream; the other is the
    // public plane refusing a gated path, which is a boundary being enforced.
    expect(refusalFields(["runs"], "public", "public_plane").reason).toBe("public_plane");
  });
});

describe("streamOutcome", () => {
  it("calls the public stream cap degraded, not failed", () => {
    // apps/cujo answers 503 when it is already holding its cap of public
    // streams and the client falls back to polling (decision 34). That is the
    // cap doing its job, and paging on it would be paging on success.
    expect(streamOutcome(503, false)).toEqual({ event: "proxy.stream.degraded", level: "warn" });
  });

  it("calls everything else a failure", () => {
    for (const status of [404, 500, 502]) {
      expect(streamOutcome(status, false).event).toBe("proxy.stream.failed");
    }
  });

  it("treats a 200 with no usable body as a failure", () => {
    // The upstream claimed success and sent nothing a client can consume.
    expect(streamOutcome(200, true).event).toBe("proxy.stream.failed");
  });
});

describe("streamStatus", () => {
  it("turns a bodyless 200 into a 502 rather than forwarding a lie", () => {
    // Forwarded as 200 the client would wait on a stream that never arrives.
    expect(streamStatus(200)).toBe(502);
  });

  it("passes every real status through, the 503 cap included", () => {
    expect(streamStatus(503)).toBe(503);
    expect(streamStatus(404)).toBe(404);
  });
});
