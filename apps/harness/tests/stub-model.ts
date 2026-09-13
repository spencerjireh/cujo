/**
 * A scripted model registered straight into pi's runtime: no HTTP, no
 * provider. The last user or tool message drives the reply, the same grammar
 * the contract stub in `apps/cujo/tests/contract/stub-model.ts` speaks:
 *
 *   CALL <tool> <json>      one tool call
 *   CALLS <json array>      several tool calls in one message ([{name, args}])
 *   SLOW                    wait until aborted
 *   SAY <text>              reply verbatim
 *   ERROR <text>            a provider error (retryable when it says 429)
 *   The operator approved your <tool> call <id>. ...
 *                           repeat that earlier call with the same arguments
 *                           (or with body "changed" when it carried mutate:true)
 *   <anything else>         "echo: <text>"
 *   (after a tool result)   "posted", unless the result text itself starts
 *                           with one of the verbs above
 */

import type { ModelProviderManifest } from "@cujo/harness-contract";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type SimpleStreamOptions,
  type ToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { Models } from "../src/model";

const STUB_PROVIDER = "stub";
export const STUB_MODEL = `${STUB_PROVIDER}/stub`;

export interface Request {
  system: string | undefined;
  messages: Message[];
  tools: string[];
}

export class StubModel {
  readonly requests: Request[] = [];
  private calls = 0;

  constructor(readonly manifest: ModelProviderManifest = manifestOf()) {}

  register(models: Models): void {
    models.registerRaw(STUB_PROVIDER, this.manifest, {
      name: STUB_PROVIDER,
      baseUrl: "http://stub.invalid",
      api: "openai-completions",
      apiKey: "stub",
      models: this.manifest.models.map((model) => ({
        id: model.modelId,
        name: model.name,
        reasoning: model.reasoning,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
      streamSimple: (model, context, options) => this.stream(context, options),
    });
  }

  private stream(context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    this.requests.push({
      system: context.systemPrompt,
      messages: context.messages,
      tools: (context.tools ?? []).map((tool) => tool.name),
    });
    void this.reply(context, options?.signal, stream);
    return stream;
  }

  private async reply(
    context: Context,
    signal: AbortSignal | undefined,
    stream: AssistantMessageEventStream,
  ): Promise<void> {
    const script = scriptOf(context.messages);
    const partial = message([], "pending");
    stream.push({ type: "start", partial });
    if (script.startsWith("SLOW")) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      stream.push({ type: "error", reason: "aborted", error: message([], "aborted", "aborted") });
      return;
    }
    if (script.startsWith("ERROR ")) {
      stream.push({
        type: "error",
        reason: "error",
        error: message([], "error", script.slice("ERROR ".length)),
      });
      return;
    }
    const approved = /^The operator approved your (\S+) call (\S+)\./.exec(script);
    if (script.startsWith("CALLS ") || script.startsWith("CALL ") || approved) {
      const calls: { name: string; args: Record<string, unknown> }[] = approved
        ? [repeatCall(context.messages, approved[2] as string)]
        : script.startsWith("CALLS ")
          ? (JSON.parse(script.slice("CALLS ".length)) as {
              name: string;
              args: Record<string, unknown>;
            }[])
          : [parseCall(script.slice("CALL ".length))];
      const content: ToolCall[] = calls.map((call) => ({
        type: "toolCall",
        id: `call-${++this.calls}`,
        name: call.name,
        arguments: call.args,
      }));
      for (const [index, toolCall] of content.entries()) {
        stream.push({ type: "toolcall_start", contentIndex: index, partial });
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial });
      }
      stream.push({ type: "done", reason: "toolUse", message: message(content, "toolUse") });
      return;
    }
    const text = script.startsWith("SAY ") ? script.slice("SAY ".length) : `echo: ${script}`;
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
    stream.push({
      type: "done",
      reason: "stop",
      message: message([{ type: "text", text }], "stop"),
    });
  }
}

function repeatCall(
  messages: Message[],
  toolCallId: string,
): { name: string; args: Record<string, unknown> } {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "toolCall" || part.id !== toolCallId) continue;
      // A model that does not repeat itself faithfully, for the test that needs one.
      if (part.arguments.mutate)
        return { name: part.name, args: { ...part.arguments, body: "changed" } };
      return { name: part.name, args: part.arguments };
    }
  }
  throw new Error(`no earlier call ${toolCallId}`);
}

function parseCall(rest: string): { name: string; args: Record<string, unknown> } {
  const space = rest.indexOf(" ");
  if (space === -1) return { name: rest, args: {} };
  return { name: rest.slice(0, space), args: JSON.parse(rest.slice(space + 1)) };
}

/** The last user text, or the last tool result when that came after it. */
function scriptOf(messages: Message[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (last.role === "toolResult") {
    const text = last.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    return /^(CALL|CALLS|SLOW|SAY|ERROR)\b/.test(text) ? text : "SAY posted";
  }
  if (last.role === "user") {
    return typeof last.content === "string"
      ? last.content
      : last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}

function message(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: STUB_PROVIDER,
    model: "stub-1",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

export function manifestOf(): ModelProviderManifest {
  return {
    name: STUB_PROVIDER,
    baseUrl: "http://stub.invalid",
    apiKey: "stub",
    models: [
      {
        name: "stub",
        modelId: "stub-1",
        contextWindow: 100_000,
        maxTokens: 4_000,
        reasoning: false,
      },
    ],
  };
}
