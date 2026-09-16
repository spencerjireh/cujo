/**
 * `create_sub_agent`: one check, one child pi session, one thread in the
 * event log (decision 124). The tool name and its `{ name, input }` shape are
 * what `agent/SKILL.md` already asks for, so the rubric did not move.
 *
 * The child gets the rubric as its system prompt and the sandbox tools only:
 * no `github-mcp` tool and no sub-agents of its own, which is the rubric's
 * "a sub-agent never posts a review" enforced rather than asked. Its events go
 * to the same log as the parent's, tagged with its thread id, as they happen;
 * a parent that times out later loses nothing the child already reported.
 */

import {
  type AgentSpec,
  MAIN_THREAD,
  type SessionEvent,
  type StreamEvent,
} from "@cujo/harness-contract";
import type { ModelMessageEvent } from "@cujo/harness-contract";
import type { Logger } from "@cujo/log";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, type AssistantMessage, type Model, Type } from "@earendil-works/pi-ai";
import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isAssistant, mapEvent, textOf } from "./events";
import { newId, now } from "./ids";
import type { Models } from "./model";
import { openPiSession } from "./pi";

export const SUB_AGENT_TOOL = "create_sub_agent";

export interface SubAgentDeps {
  spec: AgentSpec;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  models: Models;
  cwd: string;
  agentDir: string;
  tools: ToolDefinition[];
  emit: (event: SessionEvent) => void;
  stream: (event: StreamEvent) => void;
  addUsage: (message: AssistantMessage) => void;
  log: Logger;
}

const parameters = Type.Object({
  name: Type.String({ description: "The sub-agent's name; becomes the thread title." }),
  input: Type.String({ description: "The task, complete and self-contained." }),
});

export function createSubAgentTool(deps: SubAgentDeps): ToolDefinition {
  const tool: ToolDefinition<typeof parameters, { threadId: string }> = {
    name: SUB_AGENT_TOOL,
    label: "Sub-agent",
    description:
      "Delegate one task to a sub-agent with a fresh context. `name` is its title; `input` is everything it will know. It returns its final message.",
    parameters,
    async execute(toolCallId, params, signal) {
      const threadId = newId();
      const parent = { threadId: MAIN_THREAD, toolCallId };
      deps.emit({
        type: "thread.created",
        id: newId(),
        createdAt: now(),
        threadId,
        title: params.name,
        parent,
        agentInfo: { type: "dynamic", name: params.name, input: params.input },
      });
      const sourceEvents = new WeakMap<AssistantMessage, string>();
      const serverOf = (name: string) =>
        deps.tools.some((tool) => tool.name === name) ? "sandbox-mcp" : undefined;
      let lastMessage: ModelMessageEvent | null = null;
      const session = await openPiSession({
        cwd: deps.cwd,
        agentDir: deps.agentDir,
        modelRuntime: deps.models.runtime,
        model: deps.model,
        thinkingLevel: deps.thinkingLevel,
        // A check's own page when the spec names one for this child, else
        // the parent's whole rubric (decision 165).
        systemPrompt: deps.spec.subagents?.[params.name] ?? deps.spec.instructions,
        tools: deps.tools,
        sessionManager: SessionManager.inMemory(deps.cwd),
        compaction: deps.spec.config.compaction.enabled,
      });
      const onAbort = () => void session.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const started = Date.now();
      try {
        session.subscribe((event) => {
          for (const item of mapEvent(event, { threadId, serverOf, sourceEvents })) {
            if (item.kind === "store") {
              if (item.event.type === "model.message") lastMessage = item.event;
              deps.emit(item.event);
            } else {
              deps.stream(item.event);
            }
          }
          if (event.type === "message_end" && isAssistant(event.message))
            deps.addUsage(event.message);
        });
        if (signal?.aborted) throw new Error("aborted before the sub-agent started");
        await session.prompt(params.input, { expandPromptTemplates: false });
        const last = [...session.messages].reverse().find(isAssistant);
        const output = lastMessage as ModelMessageEvent | null;
        if (!last || last.stopReason === "error" || last.stopReason === "aborted") {
          const error =
            last?.stopReason === "aborted"
              ? "aborted"
              : (last?.errorMessage ?? "the sub-agent produced no message");
          deps.emit({
            type: "thread.done",
            id: newId(),
            createdAt: now(),
            threadId,
            title: params.name,
            parent,
            state: { status: "error", error, ...(output ? { output } : {}) },
          });
          deps.log.warn("harness.thread.finished", {
            thread_id: threadId,
            label: params.name,
            status: "error",
            duration_ms: Date.now() - started,
          });
          throw new Error(error);
        }
        if (!output) throw new Error("the sub-agent produced no message");
        deps.emit({
          type: "thread.done",
          id: newId(),
          createdAt: now(),
          threadId,
          title: params.name,
          parent,
          state: { status: "done", output },
        });
        deps.log.info("harness.thread.finished", {
          thread_id: threadId,
          label: params.name,
          status: "done",
          duration_ms: Date.now() - started,
        });
        return { content: [{ type: "text", text: textOf(last) }], details: { threadId } };
      } finally {
        signal?.removeEventListener("abort", onAbort);
        session.dispose();
      }
    },
  };
  return tool as unknown as ToolDefinition;
}
