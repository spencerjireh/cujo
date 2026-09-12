/**
 * Event validation (decision 105), now over the contract's own schemas. The
 * valid cases are the shapes `apps/harness` writes; the policy under test is
 * that a failure is a diagnostic and never a dropped event.
 */

import { describe, expect, it } from "vitest";
import { validateEvent } from "../../src/review/event-schema";

const base = { id: "evt-1", createdAt: "2026-08-30T00:00:00Z", threadId: "main" };

describe("valid events", () => {
  it("accepts a turn.created, with or without an approval input", () => {
    expect(
      validateEvent({
        ...base,
        type: "turn.created",
        turnId: "t1",
        previousTurnId: null,
        input: [],
      }),
    ).toEqual({ valid: true });
    expect(
      validateEvent({
        ...base,
        type: "turn.created",
        turnId: "t2",
        previousTurnId: "t1",
        input: [
          {
            type: "user.tool_approval",
            threadId: "main",
            toolCallId: "tc-1",
            approval: { status: "deny", reason: "no" },
          },
        ],
      }),
    ).toEqual({ valid: true });
  });

  it("accepts every turn.done state", () => {
    const at = "2026-08-30T00:01:00Z";
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: {
          status: "done",
          completedAt: at,
          output: null,
          requiredActions: [],
          metrics: { totalInputTokens: 100, totalOutputTokens: 50, totalReasoningTokens: 20 },
        },
      }),
    ).toEqual({ valid: true });
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: { status: "error", completedAt: at, message: "model refused" },
      }),
    ).toEqual({ valid: true });
    expect(
      validateEvent({
        ...base,
        type: "turn.done",
        state: { status: "cancelled", completedAt: at, reason: "cancelled-for-next-turn" },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a model.message with usage and tool calls", () => {
    expect(
      validateEvent({
        ...base,
        type: "model.message",
        content: null,
        usage: { inputTokens: 1, outputTokens: 2 },
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "sandbox_exec", arguments: "{}" },
            toolInfo: { type: "mcp", name: "sandbox_exec", serverName: "sandbox-mcp" },
          },
        ],
      }),
    ).toEqual({ valid: true });
  });

  it("accepts the thread events", () => {
    const parent = { threadId: "main", toolCallId: "c1" };
    expect(
      validateEvent({
        ...base,
        threadId: "th-1",
        type: "thread.created",
        title: "tests",
        parent,
        agentInfo: { type: "dynamic", name: "tests", input: "go" },
      }),
    ).toEqual({ valid: true });
    expect(
      validateEvent({
        ...base,
        threadId: "th-1",
        type: "thread.done",
        title: "tests",
        parent,
        state: { status: "error", error: "boom" },
      }),
    ).toEqual({ valid: true });
  });

  it("accepts an approval request and a tool response", () => {
    expect(
      validateEvent({
        ...base,
        type: "tool.approval_required",
        toolCalls: [{ id: "c1", sourceEventId: "evt-0" }],
      }),
    ).toEqual({ valid: true });
    expect(
      validateEvent({
        ...base,
        type: "tool.response",
        toolCallId: "c1",
        toolName: "sandbox_exec",
        content: "{}",
        isError: false,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a type the contract does not name, on an id and a timestamp alone", () => {
    expect(validateEvent({ ...base, type: "harness.future", data: { size: 1024 } })).toEqual({
      valid: true,
    });
  });
});

describe("invalid events produce a diagnostic", () => {
  it("rejects a turn.created missing turnId", () => {
    const result = validateEvent({
      ...base,
      type: "turn.created",
      previousTurnId: null,
      input: [],
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("turnId");
  });

  it("rejects a turn.done with an unknown status", () => {
    const result = validateEvent({ ...base, type: "turn.done", state: { status: "unknown" } });
    expect(result.valid).toBe(false);
    expect(result.problem).toBeDefined();
  });

  it("rejects a model.message missing threadId", () => {
    const { threadId: _dropped, ...rest } = base;
    const result = validateEvent({ ...rest, type: "model.message", content: "x" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("threadId");
  });

  it("rejects a thread.created missing title", () => {
    const result = validateEvent({
      ...base,
      type: "thread.created",
      parent: { threadId: "main", toolCallId: "c" },
      agentInfo: { type: "dynamic", name: "t", input: "" },
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("title");
  });

  it("rejects a tool.approval_required missing toolCalls", () => {
    const result = validateEvent({ ...base, type: "tool.approval_required" });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("toolCalls");
  });

  it("rejects a tool.response missing toolCallId", () => {
    const result = validateEvent({
      ...base,
      type: "tool.response",
      toolName: "x",
      content: "",
      isError: false,
    });
    expect(result.valid).toBe(false);
    expect(result.problem).toContain("toolCallId");
  });

  it("rejects an unknown type missing the base fields", () => {
    expect(validateEvent({ createdAt: "2026-08-30T00:00:00Z", type: "x.y" }).problem).toContain(
      "id",
    );
    expect(validateEvent({ id: "evt-1", type: "x.y" }).problem).toContain("createdAt");
  });

  it("rejects a non-object and null", () => {
    expect(validateEvent("not an event").valid).toBe(false);
    expect(validateEvent(null).valid).toBe(false);
  });

  it("names the issue count when several fields are wrong", () => {
    const result = validateEvent({ id: "evt-1", createdAt: "x", type: "model.message" });
    expect(result.valid).toBe(false);
    expect(result.problem).toMatch(/\(\+\d+ more\)/);
  });
});
