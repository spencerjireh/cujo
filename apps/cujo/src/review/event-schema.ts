/**
 * Shallow runtime validation for TrueForge SessionEvents (decision 105).
 *
 * The SDK exports only TypeScript types, which are erased at runtime. If an
 * upgrade renamed or dropped a field `fold` reads, the run would silently
 * resolve `clean` because evidence went missing — the same failure mode
 * `report-schema.ts` exists to prevent, one layer up (issue #90).
 *
 * Two rules, identical to the report schema's own (decisions 54, 62):
 *
 * **Extras pass through.** `.passthrough()` on every object so a newer SDK's
 * additions survive without a false rejection.
 *
 * **Warn, never reject.** `safeParse`, and an event that fails is logged as
 * `run.event.invalid` and kept in the fold — never dropped, never fatal.
 * A malformed event should be visible, not silent.
 *
 * The schema is shallow: it validates only the fields `fold.ts` and
 * `runner.service.ts` actually read, not the full SDK surface. A CI
 * type-assignability test guards the other direction — a compile failure
 * catches an SDK drift that removes a field we declared.
 */

import { z } from "zod";

const Base = {
  id: z.string(),
  createdAt: z.string(),
};

const TurnCreated = z
  .object({
    ...Base,
    type: z.literal("turn.created"),
    turnId: z.string(),
    previousTurnId: z.string().nullable().optional(),
    threadId: z.unknown().optional(),
    input: z
      .array(
        z
          .object({
            type: z.string(),
            toolCallId: z.string().optional(),
            approval: z.object({ status: z.string() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const TurnDone = z
  .object({
    ...Base,
    type: z.literal("turn.done"),
    threadId: z.unknown().optional(),
    state: z
      .object({
        status: z.enum(["done", "error", "cancelled"]),
        message: z.string().optional(),
        reason: z.string().optional(),
        completedAt: z.string().optional(),
        metrics: z
          .object({
            totalInputTokens: z.number().optional(),
            totalOutputTokens: z.number().optional(),
            totalCacheReadTokens: z.number().optional(),
            totalCacheWriteTokens: z.number().optional(),
            totalReasoningTokens: z.number().optional(),
            totalCostInUsd: z.number().optional(),
          })
          .passthrough()
          .optional(),
        output: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ModelMessage = z
  .object({
    ...Base,
    type: z.literal("model.message"),
    threadId: z.string(),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    toolCalls: z
      .array(
        z
          .object({
            id: z.string(),
            function: z.object({
              name: z.string(),
              arguments: z.string(),
            }),
          })
          .passthrough(),
      )
      .optional(),
    content: z.unknown().optional(),
    finishReason: z.string().optional(),
    refusal: z.string().nullable().optional(),
  })
  .passthrough();

const ThreadCreated = z
  .object({
    ...Base,
    type: z.literal("thread.created"),
    threadId: z.string(),
    title: z.string(),
  })
  .passthrough();

const ThreadDone = z
  .object({
    ...Base,
    type: z.literal("thread.done"),
    threadId: z.string(),
    state: z
      .object({
        status: z.enum(["done", "error"]),
        error: z.string().optional(),
        output: z
          .object({
            finishReason: z.string().optional(),
            refusal: z.string().nullable().optional(),
            content: z.unknown().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ToolApprovalRequired = z
  .object({
    ...Base,
    type: z.literal("tool.approval_required"),
    threadId: z.string(),
    toolCalls: z.array(
      z
        .object({
          id: z.string(),
          sourceEventId: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ToolResponse = z
  .object({
    ...Base,
    type: z.literal("tool.response"),
    toolCallId: z.string(),
  })
  .passthrough();

const SandboxCreated = z
  .object({
    ...Base,
    type: z.literal("sandbox.created"),
  })
  .passthrough();

const KNOWN_TYPES = new Set([
  "turn.created",
  "turn.done",
  "model.message",
  "thread.created",
  "thread.done",
  "tool.approval_required",
  "tool.response",
  "sandbox.created",
]);

const KnownEvents = z.discriminatedUnion("type", [
  TurnCreated,
  TurnDone,
  ModelMessage,
  ThreadCreated,
  ThreadDone,
  ToolApprovalRequired,
  ToolResponse,
  SandboxCreated,
]);

const UnreadBase = z
  .object({
    ...Base,
    type: z.string(),
  })
  .passthrough();

/**
 * Route by type: known types go through the strict discriminated union (so a
 * `turn.created` missing `turnId` is rejected, not swallowed by a loose
 * catch-all); unknown types go through the base-only schema (so a future
 * SDK addition passes without a false rejection).
 */
export const SessionEventSchema = z.any().superRefine((val, ctx) => {
  if (typeof val !== "object" || val === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected an object" });
    return;
  }
  const type = (val as Record<string, unknown>).type;
  const schema = typeof type === "string" && KNOWN_TYPES.has(type) ? KnownEvents : UnreadBase;
  const result = schema.safeParse(val);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue(issue);
  }
});

export type ValidatedSessionEvent = z.infer<typeof KnownEvents> | z.infer<typeof UnreadBase>;

/** Long enough to name the path; short enough for a log field. */
const PROBLEM_MAX = 200;

/**
 * Same `flatten` heuristic as `report-schema.ts`: pick the union branch with
 * the fewest issues, since that is the one the event was trying to be.
 */
function flatten(issue: z.ZodIssue): z.ZodIssue[] {
  if (issue.code !== z.ZodIssueCode.invalid_union) return [issue];
  const branches = issue.unionErrors.map((error) => error.issues.flatMap(flatten));
  let best: z.ZodIssue[] = [];
  for (const branch of branches) {
    if (branch.length > 0 && (best.length === 0 || branch.length < best.length)) best = branch;
  }
  return best.length > 0 ? best : [issue];
}

export interface EventValidation {
  valid: boolean;
  problem?: string;
}

/**
 * Validate a single event. Returns `{ valid: true }` on success, or
 * `{ valid: false, problem }` with a diagnostic string on failure.
 *
 * The event is never dropped — the caller keeps it regardless.
 */
export function validateEvent(event: unknown): EventValidation {
  const result = SessionEventSchema.safeParse(event);
  if (result.success) return { valid: true };
  const issues = result.error.issues.flatMap(flatten);
  const issue = issues[0];
  if (!issue) return { valid: false, problem: "did not match any event schema" };
  const path = issue.path.join(".");
  const named = path ? `${path}: ${issue.message}` : issue.message;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
  return { valid: false, problem: named.slice(0, PROBLEM_MAX - more.length) + more };
}
