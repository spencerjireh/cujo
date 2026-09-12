import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { type MapperOptions, MetricsAccumulator, finishReasonOf, mapEvent } from "../src/events";

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    api: "openai-completions",
    provider: "stub",
    model: "stub-1",
    usage: {
      input: 3,
      output: 4,
      cacheRead: 1,
      cacheWrite: 0,
      reasoning: 2,
      totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function options(overrides: Partial<MapperOptions> = {}): MapperOptions {
  return {
    threadId: "main",
    serverOf: (name) => (name.startsWith("sandbox_") ? "sandbox-mcp" : undefined),
    sourceEvents: new WeakMap(),
    ...overrides,
  };
}

describe("mapEvent", () => {
  it("turns an assistant message_end into model.message with text, usage and finish reason", () => {
    const message = assistant();
    const [item] = mapEvent({ type: "message_end", message }, options());
    expect(item?.kind).toBe("store");
    expect(item?.event).toMatchObject({
      type: "model.message",
      threadId: "main",
      content: "hello",
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        reasoningTokens: 2,
      },
      finishReason: "stop",
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("carries tool calls with stringified arguments and the server they belong to", () => {
    const message = assistant({
      content: [
        { type: "toolCall", id: "c1", name: "sandbox_exec", arguments: { argv: ["ls"] } },
        {
          type: "toolCall",
          id: "c2",
          name: "create_sub_agent",
          arguments: { name: "tests", input: "go" },
        },
      ],
      stopReason: "toolUse",
    });
    const [item] = mapEvent({ type: "message_end", message }, options());
    expect(item?.event).toMatchObject({
      content: null,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: { name: "sandbox_exec", arguments: '{"argv":["ls"]}' },
          toolInfo: { type: "mcp", name: "sandbox_exec", serverName: "sandbox-mcp" },
        },
        { id: "c2", toolInfo: { type: "harness", name: "create_sub_agent" } },
      ],
    });
  });

  it("remembers the event id per message so the gate can name the source", () => {
    const message = assistant();
    const sourceEvents = new WeakMap<AssistantMessage, string>();
    const [first] = mapEvent({ type: "message_end", message }, options({ sourceEvents }));
    const [again] = mapEvent({ type: "message_end", message }, options({ sourceEvents }));
    expect(first?.event.id).toBe(again?.event.id);
    expect(sourceEvents.get(message)).toBe(first?.event.id);
  });

  it("ignores user, tool-result and aborted messages", () => {
    const opts = options();
    expect(
      mapEvent(
        { type: "message_end", message: { role: "user", content: "x", timestamp: 1 } },
        opts,
      ),
    ).toEqual([]);
    expect(
      mapEvent(
        {
          type: "message_end",
          message: {
            role: "toolResult",
            toolCallId: "c",
            toolName: "t",
            content: [],
            isError: false,
            timestamp: 1,
          },
        },
        opts,
      ),
    ).toEqual([]);
    expect(
      mapEvent({ type: "message_end", message: assistant({ stopReason: "aborted" }) }, opts),
    ).toEqual([]);
  });

  it("streams text deltas and stores nothing for them", () => {
    const partial = assistant();
    const [item] = mapEvent(
      {
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "he", partial },
      },
      options({ threadId: "t9" }),
    );
    expect(item).toMatchObject({
      kind: "stream",
      event: { type: "model.message.delta", content: "he", threadId: "t9" },
    });
    expect(
      mapEvent(
        {
          type: "message_update",
          message: partial,
          assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "..", partial },
        },
        options(),
      ),
    ).toEqual([]);
  });

  it("turns tool_execution_end into tool.response with the text joined", () => {
    const event: AgentSessionEvent = {
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "sandbox_exec",
      result: {
        content: [
          { type: "text", text: '{"ok":' },
          { type: "text", text: "true}" },
        ],
        details: {},
      },
      isError: false,
    };
    const [item] = mapEvent(event, options());
    expect(item?.event).toMatchObject({
      type: "tool.response",
      toolCallId: "c1",
      toolName: "sandbox_exec",
      content: '{"ok":true}',
      isError: false,
    });
  });

  it("maps every stop reason", () => {
    expect(finishReasonOf("stop")).toBe("stop");
    expect(finishReasonOf("length")).toBe("length");
    expect(finishReasonOf("toolUse")).toBe("tool_calls");
    expect(finishReasonOf("error")).toBe("error");
    expect(finishReasonOf("aborted")).toBeUndefined();
  });

  it("passes pi's lifecycle events through as nothing", () => {
    expect(mapEvent({ type: "agent_start" }, options())).toEqual([]);
    expect(mapEvent({ type: "agent_settled" }, options())).toEqual([]);
  });
});

describe("MetricsAccumulator", () => {
  it("sums each message once and reports cost only above zero", () => {
    const acc = new MetricsAccumulator();
    const a = assistant();
    acc.add(a);
    acc.add(a);
    acc.add(assistant({ usage: { ...a.usage, cost: { ...a.usage.cost, total: 0.5 } } }));
    expect(acc.snapshot()).toEqual({
      totalInputTokens: 6,
      totalOutputTokens: 8,
      totalCacheReadTokens: 2,
      totalCacheWriteTokens: 0,
      totalReasoningTokens: 4,
      totalTokens: 20,
      totalCostInUsd: 0.5,
    });
    expect(new MetricsAccumulator().snapshot().totalCostInUsd).toBeUndefined();
  });
});
