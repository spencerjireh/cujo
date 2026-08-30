/**
 * Shallow event validation (decision 105). Each case is built from what
 * `fold.ts` and `runner.service.ts` actually read, not from the full SDK
 * surface — so a failure here means a field Cujo relies on has moved.
 */

import { describe, expect, it } from "vitest";
import { validateEvent } from "../../src/review/event-schema";

const base = { id: "evt-1", createdAt: "2026-08-30T00:00:00Z" };

describe("valid events", () => {
  it("accepts a turn.created", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.created",
        turnId: "t1",
        previousTurnId: null,
        threadId: null,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a turn.created with approval input", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.created",
        turnId: "t1",
        input: [
          {
            type: "user.tool_approval",
            toolCallId: "tc-1",
            approval: { status: "allow" },
          },
        ],
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a turn.done with metrics", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: {
          status: "done",
          completedAt: "2026-08-30T00:01:00Z",
          metrics: {
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalReasoningTokens: 20,
            totalCostInUsd: 0.01,
          },
        },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a turn.done with error status", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: { status: "error", message: "model refused" },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a turn.done with cancelled status", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: { status: "cancelled", reason: "newer_head" },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a model.message with usage and tool calls", () => {
    expect(
      validateEvent({
        ...base,
        type: "model.message",
        threadId: "main",
        usage: { inputTokens: 50, outputTokens: 30 },
        toolCalls: [
          { id: "tc-1", type: "function", function: { name: "call_tool", arguments: "{}" } },
        ],
        content: "reviewing the code",
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a thread.created", () => {
    expect(
      validateEvent({ ...base, type: "thread.created", threadId: "th-1", title: "tests" }),
    ).toEqual({ valid: true });
  });

  it("accepts a thread.done with done status", () => {
    expect(
      validateEvent({
        ...base,
        type: "thread.done",
        threadId: "th-1",
        state: { status: "done", output: { content: "report", finishReason: "stop" } },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a thread.done with error status", () => {
    expect(
      validateEvent({
        ...base,
        type: "thread.done",
        threadId: "th-1",
        state: { status: "error", error: "timeout" },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a tool.approval_required", () => {
    expect(
      validateEvent({
        ...base,
        type: "tool.approval_required",
        threadId: "main",
        toolCalls: [{ id: "tc-1", sourceEventId: "evt-0" }],
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a tool.response", () => {
    expect(validateEvent({ ...base, type: "tool.response", toolCallId: "tc-1" })).toEqual({
      valid: true,
    });
  });

  it("accepts a sandbox.created", () => {
    expect(validateEvent({ ...base, type: "sandbox.created" })).toEqual({ valid: true });
  });
});

describe("unknown event types pass through the catch-all", () => {
  it("accepts mcp.initialize", () => {
    expect(validateEvent({ ...base, type: "mcp.initialize", mcpServers: [] })).toEqual({
      valid: true,
    });
  });

  it("accepts mcp.auth_required", () => {
    expect(validateEvent({ ...base, type: "mcp.auth_required", mcpServers: [] })).toEqual({
      valid: true,
    });
  });

  it("accepts a completely new event type from a future SDK", () => {
    expect(validateEvent({ ...base, type: "sandbox.snapshot", data: { size: 1024 } })).toEqual({
      valid: true,
    });
  });
});

describe("passthrough preserves unknown fields", () => {
  it("keeps extra fields on a turn.created", () => {
    const event = {
      ...base,
      type: "turn.created",
      turnId: "t1",
      newSdkField: "hello",
      anotherField: 42,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(true);
  });

  it("keeps extra fields on nested objects", () => {
    const event = {
      ...base,
      type: "turn.done",
      state: {
        status: "done",
        metrics: { totalInputTokens: 10, futureMetric: 99 },
        newStateField: true,
      },
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(true);
  });
});

describe("invalid events produce a diagnostic", () => {
  it("rejects a turn.created missing turnId", () => {
    const result = validateEvent({ ...base, type: "turn.created" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("turnId");
  });

  it("rejects a turn.done with invalid state.status", () => {
    const result = validateEvent({
      ...base,
      type: "turn.done",
      state: { status: "unknown_status" },
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toBeDefined();
  });

  it("rejects a model.message missing threadId", () => {
    const result = validateEvent({ ...base, type: "model.message" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("threadId");
  });

  it("rejects a thread.created missing title", () => {
    const result = validateEvent({ ...base, type: "thread.created", threadId: "th-1" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("title");
  });

  it("rejects a tool.approval_required missing toolCalls", () => {
    const result = validateEvent({
      ...base,
      type: "tool.approval_required",
      threadId: "main",
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("toolCalls");
  });

  it("rejects a tool.response missing toolCallId", () => {
    const result = validateEvent({ ...base, type: "tool.response" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("toolCallId");
  });

  it("rejects an event missing the base id field", () => {
    const result = validateEvent({ createdAt: "2026-08-30T00:00:00Z", type: "sandbox.created" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("id");
  });

  it("rejects an event missing createdAt", () => {
    const result = validateEvent({ id: "evt-1", type: "sandbox.created" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("createdAt");
  });

  it("rejects a non-object", () => {
    const result = validateEvent("not an event");
    expect(result.valid).toBe(false);
    expect(result.problem).toBeDefined();
  });

  it("rejects null", () => {
    const result = validateEvent(null);
    expect(result.valid).toBe(false);
    expect(result.problem).toBeDefined();
  });

  it("names the issue count when multiple fields are wrong", () => {
    const result = validateEvent({
      ...base,
      type: "model.message",
      // missing threadId, usage has wrong type
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toMatch(/threadId/);
  });
});
