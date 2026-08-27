import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import {
  CHECK_NAMES,
  type CheckName,
  type DraftedReview,
  type Projection,
  type ReviewComment,
} from "./types";

type Event = TrueForgeApi.SessionEvent | TrueForgeApi.TurnStreamingEvent;

const REVIEW_TOOLS = new Set(["post_advisory_review", "post_blocking_review"]);

export interface FoldOptions {
  /** Turn ids whose resume Cujo itself sent, so they are not "external". */
  cujoResumeTurnIds?: ReadonlySet<string>;
}

export function emptyProjection(): Projection {
  return {
    status: "running",
    turnIds: [],
    checks: [],
    review: null,
    approval: null,
    decision: null,
    externalResume: false,
    gatedResponseSeen: false,
    error: null,
    summary: null,
  };
}

/**
 * Pull the text out of a model message. Content is either a string or a list
 * of text parts; refusals are dropped.
 */
export function messageText(message: TrueForgeApi.ModelMessageEvent | null | undefined): string {
  const content = message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * The check report is the first fenced JSON block in a model message. The
 * parse is lenient: a bare JSON object with no fence is accepted too.
 */
export function parseReport(text: string): unknown | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text].filter((c): c is string => typeof c === "string");
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function parseReview(call: TrueForgeApi.ChatCompletionMessageToolCall): DraftedReview | null {
  if (!REVIEW_TOOLS.has(call.function.name)) return null;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    // A review with unparseable arguments still counts as a drafted review.
  }
  const comments = Array.isArray(args.comments) ? (args.comments as ReviewComment[]) : [];
  return {
    tool: call.function.name as DraftedReview["tool"],
    toolCallId: call.id,
    body: typeof args.body === "string" ? args.body : "",
    comments,
  };
}

/**
 * Fold an ordered list of events into a projection. Pure: the same events give
 * the same projection, so rehydration after a restart is a replay.
 */
export function fold(events: readonly Event[], options: FoldOptions = {}): Projection {
  const p = emptyProjection();
  const messages = new Map<string, TrueForgeApi.ModelMessageEvent>();
  const cujoResumes = options.cujoResumeTurnIds ?? new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "turn.created": {
        if (!p.turnIds.includes(event.turnId)) p.turnIds.push(event.turnId);
        const approval = event.input?.find(
          (item): item is TrueForgeApi.UserToolApprovalEvent => item.type === "user.tool_approval",
        );
        if (approval) {
          p.decision = approval.approval.status;
          if (!cujoResumes.has(event.turnId)) p.externalResume = true;
        }
        break;
      }
      case "model.message": {
        messages.set(event.id, event);
        if (event.threadId === "main") {
          for (const call of event.toolCalls ?? []) {
            const review = parseReview(call);
            if (review) p.review = review;
          }
          const text = messageText(event);
          if (text && !(event.toolCalls?.length ?? 0)) p.summary = text;
        }
        break;
      }
      case "thread.created": {
        if (p.checks.some((c) => c.threadId === event.threadId)) break;
        p.checks.push({
          threadId: event.threadId,
          title: event.title,
          isCheck: (CHECK_NAMES as readonly string[]).includes(event.title as CheckName),
          status: "running",
          report: null,
          error: null,
        });
        break;
      }
      case "thread.done": {
        const check = p.checks.find((c) => c.threadId === event.threadId);
        if (!check) break;
        if (event.state.status === "done") {
          check.status = "done";
          check.report = parseReport(messageText(event.state.output));
        } else {
          check.status = "error";
          check.error = event.state.error;
          check.report = parseReport(messageText(event.state.output));
        }
        break;
      }
      case "tool.approval_required": {
        const call = event.toolCalls[0];
        if (!call) break;
        if (event.threadId !== "main") {
          // A subagent was handed the review tool. The design forbids it, so
          // the run is an error and no approve button is offered.
          p.status = "error";
          p.error = `approval requested on thread ${event.threadId}; only main may post reviews`;
          p.approval = null;
          break;
        }
        p.approval = {
          threadId: event.threadId,
          toolCallId: call.id,
          sourceEventId: call.sourceEventId,
        };
        const source = messages.get(call.sourceEventId);
        const sourceCall = source?.toolCalls?.find((c) => c.id === call.id);
        if (sourceCall) {
          const review = parseReview(sourceCall);
          if (review) p.review = review;
        }
        if (p.status !== "error") p.status = "blocked_pending";
        break;
      }
      case "tool.response": {
        if (p.approval && event.toolCallId === p.approval.toolCallId) {
          p.gatedResponseSeen = true;
        }
        break;
      }
      case "turn.done": {
        if (p.status === "error") break;
        if (event.state.status === "error") {
          p.status = "error";
          p.error = event.state.message;
          break;
        }
        if (event.state.status === "cancelled") {
          p.status = "error";
          p.error = `turn cancelled: ${event.state.reason}`;
          break;
        }
        if (p.approval) {
          if (p.gatedResponseSeen) p.status = "blocked_posted";
          else if (p.decision === "deny") p.status = "denied";
          else if (p.decision === "allow") {
            p.status = "error";
            p.error = "approval allowed but the review tool never responded";
          } else p.status = "blocked_pending";
        } else {
          p.status = "clean";
        }
        break;
      }
      default:
        break;
    }
  }
  return p;
}
