/**
 * The harness contract (decision 123): the eight operations `apps/cujo` needs
 * from an agent harness, as the types both sides compile against and the Zod
 * schemas the harness validates inbound bodies with.
 *
 * The vocabulary is the one TrueForge used, kept because `fold.ts`, the event
 * schema and the board already speak it: a session holds a chain of turns; a
 * turn is a chain of events tagged by thread (`main` is the parent, every
 * sub-agent gets its own); a gated tool call ends the turn with a
 * `tool.approval_required` and the answer is the next turn's input. Names are
 * camelCase end to end; there is no wire translation.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent spec and settings
// ---------------------------------------------------------------------------

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const ModelParamsSchema = z
  .object({
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();
export type ModelParams = z.infer<typeof ModelParamsSchema>;

export const McpServerRefSchema = z
  .object({
    name: z.string().min(1),
    /**
     * Exact tool names that pause for a human. Absent or empty means none: the
     * harness has no `@write`/`@destructive` classes (decision 128).
     */
    requireApprovalForTools: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type McpServerRef = z.infer<typeof McpServerRefSchema>;

export const AgentSpecSchema = z
  .object({
    /** `<provider name>/<model name>` as registered through the model-provider manifest. */
    model: z
      .object({ name: z.string().regex(/^[^/]+\/.+$/), params: ModelParamsSchema.optional() })
      .strict(),
    instructions: z.string().min(1),
    mcpServers: z.array(McpServerRefSchema).default([]),
    config: z
      .object({
        /** Assistant messages per turn before the harness ends it as an error. */
        iterationLimit: z.number().int().positive(),
        compaction: z.object({ enabled: z.boolean() }).strict(),
      })
      .strict(),
  })
  .strict();
export type AgentSpec = z.infer<typeof AgentSpecSchema>;
export type AgentSpecInput = z.input<typeof AgentSpecSchema>;

export const McpServerManifestSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    description: z.string(),
  })
  .strict();
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;

export const ModelProviderManifestSchema = z
  .object({
    name: z.string().min(1),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    models: z
      .array(
        z
          .object({
            /** The name Cujo's spec refers to, after the provider's slash. */
            name: z.string().min(1),
            /** What the provider's API calls it. */
            modelId: z.string().min(1),
            contextWindow: z.number().int().positive(),
            maxTokens: z.number().int().positive(),
            /** Whether the model accepts a reasoning effort at all (decision 127). */
            reasoning: z.boolean(),
            compat: z.record(z.boolean()).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ModelProviderManifest = z.infer<typeof ModelProviderManifestSchema>;

// ---------------------------------------------------------------------------
// Turn input
// ---------------------------------------------------------------------------

export const UserMessageInputSchema = z
  .object({ type: z.literal("user.message"), content: z.string().min(1) })
  .strict();
export const ToolApprovalInputSchema = z
  .object({
    type: z.literal("user.tool_approval"),
    threadId: z.string().min(1),
    toolCallId: z.string().min(1),
    approval: z.discriminatedUnion("status", [
      z.object({ status: z.literal("allow") }).strict(),
      z.object({ status: z.literal("deny"), reason: z.string().min(1) }).strict(),
    ]),
  })
  .strict();
export const TurnInputItemSchema = z.discriminatedUnion("type", [
  UserMessageInputSchema,
  ToolApprovalInputSchema,
]);
export type UserMessageInput = z.infer<typeof UserMessageInputSchema>;
export type ToolApprovalInput = z.infer<typeof ToolApprovalInputSchema>;
export type TurnInputItem = z.infer<typeof TurnInputItemSchema>;

export const CreateTurnBodySchema = z
  .object({ input: z.array(TurnInputItemSchema).min(1) })
  .strict();
export const CreateSessionBodySchema = z.object({ spec: AgentSpecSchema }).strict();

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** The parent agent's thread. Every sub-agent gets a generated id. */
export const MAIN_THREAD = "main";

const eventBase = {
  id: z.string().min(1),
  createdAt: z.string().min(1),
  threadId: z.string().min(1),
};

export const ToolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).strict(),
    toolInfo: z
      .object({
        /** `mcp` for a bridged MCP tool, `harness` for `create_sub_agent`. */
        type: z.enum(["mcp", "harness"]),
        name: z.string().min(1),
        serverName: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ModelMessageUsageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
  })
  .strict();
export type ModelMessageUsage = z.infer<typeof ModelMessageUsageSchema>;

export const FINISH_REASONS = ["stop", "length", "tool_calls", "error"] as const;

export const ModelMessageEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("model.message"),
    content: z.string().nullable(),
    toolCalls: z.array(ToolCallSchema).optional(),
    usage: ModelMessageUsageSchema.optional(),
    finishReason: z.enum(FINISH_REASONS).optional(),
    /** Never set by this harness; kept because the fold reads it. */
    refusal: z.string().nullable().optional(),
  })
  .strict();
export type ModelMessageEvent = z.infer<typeof ModelMessageEventSchema>;

export const ModelMessageDeltaEventSchema = z
  .object({ ...eventBase, type: z.literal("model.message.delta"), content: z.string() })
  .strict();
export type ModelMessageDeltaEvent = z.infer<typeof ModelMessageDeltaEventSchema>;

export const ToolApprovalRequiredEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool.approval_required"),
    toolCalls: z
      .array(z.object({ id: z.string().min(1), sourceEventId: z.string().min(1) }).strict())
      .min(1),
  })
  .strict();
export type ToolApprovalRequiredEvent = z.infer<typeof ToolApprovalRequiredEventSchema>;

export const TurnMetricsSchema = z
  .object({
    totalInputTokens: z.number().optional(),
    totalOutputTokens: z.number().optional(),
    totalCacheReadTokens: z.number().optional(),
    totalCacheWriteTokens: z.number().optional(),
    totalReasoningTokens: z.number().optional(),
    totalCostInUsd: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .strict();
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;

export const CANCEL_REASONS = ["client-cancelled", "cancelled-for-next-turn"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const TurnStateDoneSchema = z
  .object({
    status: z.literal("done"),
    completedAt: z.string().min(1),
    output: ModelMessageEventSchema.nullable(),
    requiredActions: z.array(ToolApprovalRequiredEventSchema),
    metrics: TurnMetricsSchema.optional(),
  })
  .strict();
export const TurnStateErrorSchema = z
  .object({
    status: z.literal("error"),
    completedAt: z.string().min(1),
    message: z.string(),
    metrics: TurnMetricsSchema.optional(),
  })
  .strict();
export const TurnStateCancelledSchema = z
  .object({
    status: z.literal("cancelled"),
    completedAt: z.string().min(1),
    reason: z.enum(CANCEL_REASONS),
    metrics: TurnMetricsSchema.optional(),
  })
  .strict();
export const TurnStateRunningSchema = z.object({ status: z.literal("running") }).strict();
export const TurnStateSchema = z.discriminatedUnion("status", [
  TurnStateRunningSchema,
  TurnStateDoneSchema,
  TurnStateErrorSchema,
  TurnStateCancelledSchema,
]);
export const TurnStateFinishedSchema = z.discriminatedUnion("status", [
  TurnStateDoneSchema,
  TurnStateErrorSchema,
  TurnStateCancelledSchema,
]);
export type TurnState = z.infer<typeof TurnStateSchema>;
export type TurnStateDone = z.infer<typeof TurnStateDoneSchema>;
export type TurnStateError = z.infer<typeof TurnStateErrorSchema>;
export type TurnStateCancelled = z.infer<typeof TurnStateCancelledSchema>;
export type TurnStateFinished = z.infer<typeof TurnStateFinishedSchema>;

export const TurnCreatedEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("turn.created"),
    turnId: z.string().min(1),
    previousTurnId: z.string().nullable(),
    input: z.array(TurnInputItemSchema),
  })
  .strict();
export type TurnCreatedEvent = z.infer<typeof TurnCreatedEventSchema>;

export const TurnDoneEventSchema = z
  .object({ ...eventBase, type: z.literal("turn.done"), state: TurnStateFinishedSchema })
  .strict();
export type TurnDoneEvent = z.infer<typeof TurnDoneEventSchema>;

const threadParent = z
  .object({ threadId: z.string().min(1), toolCallId: z.string().min(1) })
  .strict();

export const ThreadCreatedEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("thread.created"),
    title: z.string(),
    parent: threadParent,
    agentInfo: z
      .object({ type: z.literal("dynamic"), name: z.string(), input: z.string() })
      .strict(),
  })
  .strict();
export type ThreadCreatedEvent = z.infer<typeof ThreadCreatedEventSchema>;

export const ThreadDoneEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("thread.done"),
    title: z.string(),
    parent: threadParent,
    state: z.discriminatedUnion("status", [
      z.object({ status: z.literal("done"), output: ModelMessageEventSchema }).strict(),
      z
        .object({
          status: z.literal("error"),
          error: z.string(),
          output: ModelMessageEventSchema.optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type ThreadDoneEvent = z.infer<typeof ThreadDoneEventSchema>;

export const ToolResponseEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool.response"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    content: z.string(),
    isError: z.boolean(),
  })
  .strict();
export type ToolResponseEvent = z.infer<typeof ToolResponseEventSchema>;

/** Every event the harness stores. */
export const SessionEventSchema = z.discriminatedUnion("type", [
  TurnCreatedEventSchema,
  TurnDoneEventSchema,
  ModelMessageEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
]);
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** What a subscription streams: the stored events plus text deltas. */
export const StreamEventSchema = z.discriminatedUnion("type", [
  ...SessionEventSchema.options,
  ModelMessageDeltaEventSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const SessionEventItemSchema = z
  .object({ seq: z.number().int(), turnId: z.string().min(1), event: SessionEventSchema })
  .strict();
export type SessionEventItem = z.infer<typeof SessionEventItemSchema>;

export const TurnSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    createdAt: z.string().min(1),
    previousTurnId: z.string().nullable(),
    state: TurnStateSchema,
    input: z.array(TurnInputItemSchema),
  })
  .strict();
export type Turn = z.infer<typeof TurnSchema>;

// ---------------------------------------------------------------------------
// The eight operations, as the client-side interface
// ---------------------------------------------------------------------------

export interface HarnessClient {
  bootstrap(): Promise<string[]>;
  createSession(spec: AgentSpecInput): Promise<string>;
  startTurn(sessionId: string, message: string): Promise<string>;
  resume(
    sessionId: string,
    approval: { threadId: string; toolCallId: string },
    decision: "allow" | "deny",
    denyReason?: string,
  ): Promise<string>;
  subscribe(sessionId: string, turnId: string): Promise<AsyncIterable<StreamEvent>>;
  cancelTurn(sessionId: string): Promise<void>;
  listEvents(sessionId: string): Promise<{ turnId: string; event: SessionEvent }[]>;
  listTurns(sessionId: string): Promise<Turn[]>;
}
