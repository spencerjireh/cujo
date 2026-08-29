import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import {
  agentFindings,
  hardRuleFindings,
  invalidReportFindings,
  isMaliceClaim,
  mergeFindings,
  missingCheckFindings,
} from "./findings";
import { checkTimings } from "./timings";
import {
  CHECK_NAMES,
  type CheckName,
  type DraftedReview,
  type Finding,
  type PendingApproval,
  type Projection,
  type ReviewComment,
  type UsageTotals,
} from "./types";

export type Event = TrueForgeApi.SessionEvent | TrueForgeApi.TurnStreamingEvent;

const REVIEW_TOOLS = new Set(["post_advisory_review", "post_blocking_review", "post_gated_review"]);

/** The one review tool `agent-spec.ts` gates. Its call is a draft, not a post. */
const GATED_TOOL = "post_gated_review";

/**
 * File a parsed review under what it is. The ungated tools post the moment the
 * model calls them, so their call is the record of a posted review; the gated
 * one is a draft until a human answers. Two slots and not one, because a run
 * on the malice path holds both — the advisory observation is already public
 * while the accusation waits — and a single field would have the second
 * overwrite the record of the first.
 */
function recordReview(p: Projection, review: DraftedReview): void {
  if (review.tool === GATED_TOOL) p.gatedReview = review;
  else p.review = review;
}

/**
 * The agent findings that may be published. The gated review's `findings[]` is
 * its accusation in list form, and `p.findings` reaches the anonymous board, so
 * it joins only once the review is on the pull request. The hard-rule hits are
 * not held back: those are Cujo's own deterministic observation, which is the
 * half of the design that always publishes.
 *
 * A response is not enough on its own. A **denied** approval also produces a
 * `tool.response` — the refusal — so `gatedResponseSeen` alone would publish
 * the accusation of every review a human turned down, which is the one outcome
 * that must leave nothing behind. The decision is checked first, exactly as the
 * terminal ladder checks it.
 */
function publishableAgentFindings(p: Projection): Finding[] {
  const gatedPosted = p.gatedResponseSeen && p.decision !== "deny";
  return [...agentFindings(p.review), ...(gatedPosted ? agentFindings(p.gatedReview) : [])];
}

export interface FoldOptions {
  /** Turn ids whose resume Cujo itself sent, so they are not "external". */
  cujoResumeTurnIds?: ReadonlySet<string>;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    messages: 0,
  };
}

/**
 * Add one model message's usage to a running total.
 *
 * Mutates, because the fold owns both objects and copying one per message on a
 * run with hundreds of them buys nothing.
 */
function addMessageUsage(total: UsageTotals, usage: TrueForgeApi.ModelMessageUsage): void {
  total.inputTokens += usage.inputTokens ?? 0;
  total.outputTokens += usage.outputTokens ?? 0;
  total.cacheReadTokens += usage.cacheReadTokens ?? 0;
  total.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  total.messages += 1;
}

/**
 * Fold one turn's metrics into the run's total.
 *
 * Every field on `TurnMetrics` is optional, so an absent one adds nothing
 * rather than a zero — and `costUsd` and `reasoningTokens` stay absent until
 * some turn reports them, because "no cost reported" and "cost zero" are not
 * the same claim (decision 54's rule, applied to a different producer).
 */
function addTurnMetrics(total: UsageTotals, metrics: TrueForgeApi.TurnMetrics): void {
  total.inputTokens += metrics.totalInputTokens ?? 0;
  total.outputTokens += metrics.totalOutputTokens ?? 0;
  total.cacheReadTokens += metrics.totalCacheReadTokens ?? 0;
  total.cacheWriteTokens += metrics.totalCacheWriteTokens ?? 0;
  if (metrics.totalReasoningTokens !== undefined) {
    total.reasoningTokens = (total.reasoningTokens ?? 0) + metrics.totalReasoningTokens;
  }
  if (metrics.totalCostInUsd !== undefined) {
    total.costUsd = (total.costUsd ?? 0) + metrics.totalCostInUsd;
  }
}

export function emptyProjection(): Projection {
  return {
    status: "running",
    turnIds: [],
    checks: [],
    review: null,
    gatedReview: null,
    hardRuleHits: [],
    findings: [],
    approval: null,
    decision: null,
    externalResume: false,
    gatedResponseSeen: false,
    error: null,
    summary: null,
    usage: emptyUsage(),
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
        // Counted before the map is written, so the same event arriving twice
        // adds once. The runner dedupes by id and `hydrate` replaces by id, so
        // today's input is already unique — but a sum that depends on a
        // caller's invariant is a sum that silently doubles the day it changes.
        if (!messages.has(event.id) && event.usage) {
          const check = p.checks.find((c) => c.threadId === event.threadId);
          if (check) {
            check.usage ??= emptyUsage();
            addMessageUsage(check.usage, event.usage);
          }
        }
        messages.set(event.id, event);
        if (event.threadId === "main") {
          for (const call of event.toolCalls ?? []) {
            const review = parseReview(call);
            if (review) recordReview(p, review);
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
          startedAt: event.createdAt ?? null,
          endedAt: null,
        });
        break;
      }
      case "thread.done": {
        const check = p.checks.find((c) => c.threadId === event.threadId);
        if (!check) break;
        check.endedAt = event.createdAt ?? null;
        // Why the final message ended, kept beside what it said. A report that
        // did not parse and a report that was never written are the same
        // `check_missing` without this: `finish_reason: "length"` means the
        // model hit its output cap mid-JSON, which is a cap to raise, and a
        // refusal means it declined, which is neither. `messageText` drops the
        // refusal by design, so it has to be read off the event itself.
        check.finishReason = event.state.output?.finishReason ?? null;
        check.refused = Boolean(event.state.output?.refusal);
        if (event.state.status === "done") {
          check.status = "done";
          check.report = parseReport(messageText(event.state.output));
        } else {
          check.status = "error";
          check.error = event.state.error;
          check.report = parseReport(messageText(event.state.output));
        }
        // Both inputs are in hand exactly here: the thread's two timestamps and
        // the report holding the wrapped commands' own durations.
        check.timings = checkTimings(check);
        p.hardRuleHits = [...hardRuleFindings(p.checks), ...invalidReportFindings(p.checks)];
        p.findings = mergeFindings(p.hardRuleHits, publishableAgentFindings(p));
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
          if (review) recordReview(p, review);
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
        // Before the status ladder below, which `break`s out of this case in
        // half a dozen places: what the turn cost is true whichever way it
        // ended, and an error turn is exactly the one whose cost is worth
        // seeing. Only a `done` turn carries metrics at all.
        if (event.state.status === "done" && event.state.metrics) {
          addTurnMetrics(p.usage, event.state.metrics);
        }
        // The turn is over, so a check that never arrived is missing for good.
        p.findings = mergeFindings(
          [...p.hardRuleHits, ...missingCheckFindings(p.checks)],
          publishableAgentFindings(p),
        );
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
        } else if (p.hardRuleHits.some(isMaliceClaim) && !p.gatedReview) {
          // Under-gating: a rule accused the code and the agent published that
          // conclusion on its own authority, or not at all. This is the one
          // direction of model error the trusted side can detect — Cujo cannot
          // tell whether a `post_gated_review` was needed, but it can always
          // tell when one was — and it is why the rules are re-derived here
          // (decision 21). Nothing can be prevented: the review is already on
          // the pull request under the bot's name by the time this runs.
          const titles = (list: readonly Finding[]) => list.map((f) => f.title).join("; ");
          p.status = "error";
          p.error = `malice rule tripped (${titles(
            p.hardRuleHits.filter(isMaliceClaim),
          )}) but the agent did not hold the accusation for a human`;
        } else if (p.review?.tool === "post_blocking_review") {
          // Cujo blocked the merge on its own authority: a correctness
          // critical, which nobody was asked about. No approval was ever
          // raised, so `blocked_posted` cannot be reached from here and
          // `clean` would be a lie about a REQUEST_CHANGES that posted.
          p.status = "blocked_unattended";
        } else if (
          p.review?.tool === "post_advisory_review" &&
          !p.gatedReview &&
          p.findings.some((f) => f.severity === "critical")
        ) {
          // Posted an advisory and nothing else, despite a critical. The
          // advisory has already posted (it is not gated), so the
          // contradiction is recorded rather than hidden behind `clean`.
          const titles = (list: readonly Finding[]) => list.map((f) => f.title).join("; ");
          p.status = "error";
          p.error =
            p.hardRuleHits.length > 0
              ? `hard rule tripped (${titles(p.hardRuleHits)}) but the agent posted an advisory review`
              : `critical finding (${titles(
                  p.findings.filter((f) => f.severity === "critical"),
                )}) but the agent posted an advisory review`;
        } else if (p.gatedReview) {
          // A gated call that never raised `tool.approval_required` means the
          // tool is not in `require_approval_for_tools` on this session, so the
          // accusation posted unattended. Calling that clean would hide a
          // broken registration, exactly as the no-review case below does.
          p.status = "error";
          p.error = "the agent drafted a gated review but no approval was requested";
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

/**
 * How the last turn in this list ended, as the harness said it, or null when
 * no turn has ended yet.
 *
 * `fold` cannot answer this either. It flattens `cancelled` into
 * `status: "error"` with the reason written into `p.error` as prose, so a
 * caller that needs to tell "stopped on purpose" from "failed" would have to
 * match on that sentence — and the one caller that needs it, the turn retry,
 * would start a new turn for a run somebody had just superseded or denied if
 * the wording ever changed.
 */
export function lastTurnOutcome(events: readonly Event[]): "done" | "error" | "cancelled" | null {
  let outcome: "done" | "error" | "cancelled" | null = null;
  for (const event of events) {
    if (event.type !== "turn.done") continue;
    outcome = event.state.status;
  }
  return outcome;
}

/**
 * The approval the session is still waiting on, or null.
 *
 * `fold` cannot answer this. It never clears `approval`, and `decision` does
 * not record which tool call it answered, so a session holding one answered
 * and one outstanding approval folds to both fields set — indistinguishable
 * from an approval that was already dealt with.
 *
 * The question matters because an approval is outstanding on the session, not
 * on the turn that requested it: while one is pending, TrueForge refuses every
 * later user message on the thread (decision 39).
 */
export function pendingApproval(events: readonly Event[]): PendingApproval | null {
  let candidate: PendingApproval | null = null;
  for (const event of events) {
    switch (event.type) {
      case "tool.approval_required": {
        // Read defensively: the events come off the wire, and the answer here
        // decides whether Cujo sends a deny. A shape that does not carry an
        // identifiable tool call is no evidence that anything is pending.
        const call = event.toolCalls?.[0];
        // Only `main` may hold a review tool call. A request on any other
        // thread is the design violation `fold` reports as an error, and
        // answering it is not this function's business.
        if (!call?.id || event.threadId !== "main") break;
        candidate = {
          threadId: event.threadId,
          toolCallId: call.id,
          sourceEventId: call.sourceEventId,
        };
        break;
      }
      case "turn.created": {
        const id = candidate?.toolCallId;
        if (!id) break;
        const answered = event.input?.some(
          (item) => item.type === "user.tool_approval" && item.toolCallId === id,
        );
        if (answered) candidate = null;
        break;
      }
      default:
        break;
    }
  }
  return candidate;
}
