import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { agentFindings, hardRuleFindings, mergeFindings } from "./findings";
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
    hardRuleHits: [],
    findings: [],
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

const CALL_TOOL = "call_tool";
const REVIEW_MCP_SERVER = "github-mcp";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    return asObject(JSON.parse(raw));
  } catch {
    // A review with unparseable arguments still counts as a drafted review.
    return {};
  }
}

/**
 * The review tool call, whichever way the harness exposed the tool to the
 * model: directly by name, or through TrueForge's `call_tool` meta-tool
 * (`{mcp_server, tool_name, input}`), which is what the server does by
 * default (contract test: "a review goes through call_tool"). Through
 * `call_tool` the server must be github-mcp: a same-named tool elsewhere
 * posts nothing, and a run must not fold clean on it.
 */
export function parseReview(
  call: TrueForgeApi.ChatCompletionMessageToolCall,
): DraftedReview | null {
  let args = parseArguments(call.function.arguments);
  let tool = call.function.name;
  if (tool === CALL_TOOL) {
    if (args.mcp_server !== REVIEW_MCP_SERVER || typeof args.tool_name !== "string") return null;
    tool = args.tool_name;
    args = asObject(args.input);
  }
  if (!REVIEW_TOOLS.has(tool)) return null;
  const comments = Array.isArray(args.comments) ? (args.comments as ReviewComment[]) : [];
  return {
    tool: tool as DraftedReview["tool"],
    toolCallId: call.id,
    body: typeof args.body === "string" ? args.body : "",
    comments,
    findings: Array.isArray(args.findings) ? args.findings : [],
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
        p.hardRuleHits = hardRuleFindings(p.checks);
        p.findings = mergeFindings(p.hardRuleHits, agentFindings(p.review));
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
        p.findings = mergeFindings(p.hardRuleHits, agentFindings(p.review));
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
          // A denied call still gets a tool.response (the refusal), so the
          // decision is checked before the response.
          if (p.decision === "deny") p.status = "denied";
          else if (p.gatedResponseSeen) p.status = "blocked_posted";
          else if (p.decision === "allow") {
            p.status = "error";
            p.error = "approval allowed but the review tool never responded";
          } else p.status = "blocked_pending";
        } else if (p.review && p.hardRuleHits.length > 0) {
          // The advisory review has already posted (it is not gated), so the
          // contradiction is recorded rather than hidden behind `clean`.
          p.status = "error";
          p.error = `hard rule tripped (${p.hardRuleHits
            .map((f) => f.title)
            .join("; ")}) but the agent posted an advisory review`;
        } else if (p.review) {
          p.status = "clean";
        } else {
          // A turn that never called a review tool posted nothing; calling
          // that clean would hide a broken github-mcp registration.
          p.status = "error";
          p.error = "turn ended without a review";
        }
        break;
      }
      default:
        break;
    }
  }
  return p;
}
