/**
 * pi events in, contract events out. Pure, so the tests drive it without a
 * session, and shared by the parent and every sub-agent (each passes its own
 * thread id).
 *
 * What is dropped on purpose: user and tool-result `message_end`s (the turn's
 * input is on `turn.created`; a tool result is `tool.response`), thinking
 * deltas, and pi's own lifecycle chatter. What is added: an id and a timestamp
 * per event, because the contract promises both and the fold dedups on the id.
 */

import type {
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  ModelMessageUsage,
  SessionEvent,
  ToolCall,
  ToolResponseEvent,
  TurnMetrics,
} from "@cujo/harness-contract";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { newId, now } from "./ids";

export type MappedEvent =
  | { kind: "store"; event: SessionEvent }
  | { kind: "stream"; event: ModelMessageDeltaEvent };

export interface MapperOptions {
  threadId: string;
  /** Which MCP server a tool came from, for `toolInfo.serverName`. */
  serverOf: (toolName: string) => string | undefined;
  /** Filled by the mapper so the gate can name the message a call came from. */
  sourceEvents: WeakMap<AssistantMessage, string>;
}

export function isAssistant(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant";
}

export function textOf(message: AssistantMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function toolCallsOf(
  message: AssistantMessage,
  serverOf: MapperOptions["serverOf"],
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const part of message.content) {
    if (part.type !== "toolCall") continue;
    const serverName = serverOf(part.name);
    calls.push({
      id: part.id,
      type: "function",
      function: { name: part.name, arguments: JSON.stringify(part.arguments ?? {}) },
      toolInfo: serverName
        ? { type: "mcp", name: part.name, serverName }
        : { type: "harness", name: part.name },
    });
  }
  return calls;
}

export function usageOf(usage: Usage): ModelMessageUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    ...(usage.reasoning !== undefined ? { reasoningTokens: usage.reasoning } : {}),
  };
}

export function finishReasonOf(
  stopReason: AssistantMessage["stopReason"],
): ModelMessageEvent["finishReason"] {
  switch (stopReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "toolUse":
      return "tool_calls";
    case "error":
      return "error";
    default:
      return undefined;
  }
}

export function modelMessageOf(
  message: AssistantMessage,
  options: MapperOptions,
): ModelMessageEvent {
  const known = options.sourceEvents.get(message);
  const id = known ?? newId();
  if (!known) options.sourceEvents.set(message, id);
  const toolCalls = toolCallsOf(message, options.serverOf);
  const finishReason = finishReasonOf(message.stopReason);
  const text = textOf(message);
  return {
    type: "model.message",
    id,
    createdAt: new Date(message.timestamp || Date.now()).toISOString(),
    threadId: options.threadId,
    content: text === "" ? null : text,
    ...(toolCalls.length ? { toolCalls } : {}),
    usage: usageOf(message.usage),
    ...(finishReason ? { finishReason } : {}),
  };
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter((part) => part && typeof part === "object" && part.type === "text")
        .map((part) => String((part as { text: unknown }).text))
        .join("");
    }
    if (typeof content === "string") return content;
  }
  return "";
}

export function mapEvent(event: AgentSessionEvent, options: MapperOptions): MappedEvent[] {
  switch (event.type) {
    case "message_end": {
      if (!isAssistant(event.message)) return [];
      // pi persists an aborted message too; it says nothing the fold needs.
      if (event.message.stopReason === "aborted") return [];
      return [{ kind: "store", event: modelMessageOf(event.message, options) }];
    }
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type !== "text_delta") return [];
      return [
        {
          kind: "stream",
          event: {
            type: "model.message.delta",
            id: newId(),
            createdAt: now(),
            threadId: options.threadId,
            content: inner.delta,
          },
        },
      ];
    }
    case "tool_execution_end": {
      const response: ToolResponseEvent = {
        type: "tool.response",
        id: newId(),
        createdAt: now(),
        threadId: options.threadId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: toolResultText(event.result),
        isError: event.isError,
      };
      return [{ kind: "store", event: response }];
    }
    default:
      return [];
  }
}

/** Sums usage across every assistant message of a turn, children included. */
export class MetricsAccumulator {
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private reasoning = 0;
  private cost = 0;
  private total = 0;
  private seen = new WeakSet<AssistantMessage>();

  add(message: AssistantMessage): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    const u = message.usage;
    this.input += u.input;
    this.output += u.output;
    this.cacheRead += u.cacheRead;
    this.cacheWrite += u.cacheWrite;
    this.reasoning += u.reasoning ?? 0;
    this.cost += u.cost?.total ?? 0;
    this.total += u.totalTokens;
  }

  snapshot(): TurnMetrics {
    return {
      totalInputTokens: this.input,
      totalOutputTokens: this.output,
      totalCacheReadTokens: this.cacheRead,
      totalCacheWriteTokens: this.cacheWrite,
      totalReasoningTokens: this.reasoning,
      totalTokens: this.total,
      // Absent means "not reported" to the fold; a registered model has zero
      // cost, and zero would read as "free" on the board.
      ...(this.cost > 0 ? { totalCostInUsd: this.cost } : {}),
    };
  }
}
