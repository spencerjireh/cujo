import type {
  ModelMessageEvent,
  ModelMessageUsage,
  SessionEvent,
  StreamEvent,
  ToolCall,
  TurnMetrics,
} from "@cujo/harness-contract";
import { type RenderInput, renderReviewBody, reviewComments } from "@cujo/review-render";
import {
  agentFindings,
  hardRuleFindings,
  invalidReportFindings,
  mergeFindings,
  missingCheckFindings,
} from "./findings";
import { checkTimings, emptySetup, settleSetup } from "./timings";
import {
  CHECK_NAMES,
  type CheckName,
  type DraftedReview,
  type Finding,
  type Projection,
  type ReviewComment,
  type ReviewMode,
  type UsageTotals,
} from "./types";

export type Event = SessionEvent | StreamEvent;

/**
 * The two tools that post a review. A call is not a posted review: GitHub can
 * refuse one (a 422 on an App's own pull request did, decision 140), so the
 * review is recorded from the call's `tool.response`, and only when that is
 * not an error.
 */
const REVIEW_TOOLS = new Set(["post_advisory_review", "post_blocking_review"]);

/**
 * Prefix of the `error` a run ends with when its review tool was called and
 * GitHub refused the post. `retryTurn` matches on it: the refusal is
 * deterministic for the same head, so a retry is a second sandbox for the
 * same answer (decision 140).
 */
export const REVIEW_POST_FAILED = "review post failed: ";

/** One line of a refused post, short enough for a status row. */
function postFailureText(tool: string, content: string): string {
  const line =
    content
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  const capped = line.length > 200 ? `${line.slice(0, 200)}…` : line;
  return `${REVIEW_POST_FAILED}${tool}${capped ? ` — ${capped}` : ""}`;
}

export interface FoldOptions {
  /**
   * Which review these events are (decision 135). The events do not say: a
   * diff run's stream is a sandbox run's stream with no checks in it, and
   * "no check reported" is `unproven` for one and the whole design for the
   * other. Absent means `sandbox`, which is what every stored event stream
   * from before there were two reviews is.
   */
  mode?: ReviewMode;
}

function emptyUsage(): UsageTotals {
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
function addMessageUsage(total: UsageTotals, usage: ModelMessageUsage): void {
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
function addTurnMetrics(total: UsageTotals, metrics: TurnMetrics): void {
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
    hardRuleHits: [],
    findings: [],
    error: null,
    summary: null,
    usage: emptyUsage(),
    setup: emptySetup(),
  };
}

/** Pull the text out of a model message. A refusal is not text. */
export function messageText(message: ModelMessageEvent | null | undefined): string {
  return (message?.content ?? "").trim();
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

/**
 * `provisioned_ms` out of a `sandbox_create` tool response, or nothing.
 *
 * The content is a JSON string the MCP server wrote, so it parses or it does
 * not. Nothing here throws and nothing here trusts a shape: a response that is
 * some other tool's, or malformed, or carries a `provisioned_ms` that is not a
 * finite number, contributes nothing. The field is a measurement, and a
 * measurement nobody made is absent rather than zero.
 */
function provisionedMs(content: unknown): number | undefined {
  if (typeof content !== "string" || !content.includes("provisioned_ms")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;
  const ms = parsed.provisioned_ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : undefined;
}

/** A plain object, which is what a `coverage` value has to be to render. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
 * The review tool call. The harness exposes MCP tools to the model by name
 * (decision 128), so the name on the call is the tool.
 */
export function parseReview(call: ToolCall): DraftedReview | null {
  const args = parseArguments(call.function.arguments);
  const tool = call.function.name;
  if (!REVIEW_TOOLS.has(tool)) return null;
  const findings = Array.isArray(args.findings) ? args.findings : [];
  const body = typeof args.body === "string" ? args.body : "";
  // A session pins its rubric at creation (decision 16), so an in-flight pull
  // request goes on sending `comments[]` long after the rubric stopped asking
  // for one. Those arrive here whole — `apps/cujo` reads the model's raw
  // arguments off the `model.message` event, before `github-mcp`'s schema sees
  // them — and `github-mcp` prefers them too, so the board matches what posted.
  const sent = Array.isArray(args.comments) ? (args.comments as ReviewComment[]) : [];
  // Cast, but only after checking the shape. These are raw values off a
  // `model.message` tool call — `apps/cujo` reads them before `github-mcp`'s
  // Zod schema ever sees the call, so nothing has validated them, and a `cast`
  // asserts a type at compile time while proving nothing at run time. The
  // renderer is defensive about this too; belt and braces, because a throw here
  // is inside `fold`, which is replayed on every rehydration, so one malformed
  // review would be a run that can never be projected again.
  const input: RenderInput = {
    body,
    findings: findings as RenderInput["findings"],
    coverage: isObject(args.coverage)
      ? (args.coverage as unknown as RenderInput["coverage"])
      : undefined,
    egress: Array.isArray(args.egress) ? (args.egress as RenderInput["egress"]) : undefined,
  };
  const reviewTool = tool as DraftedReview["tool"];
  // The same renderer `github-mcp` posts with, so the board cannot describe a
  // finding differently from the pull request does (decision 74). Guarded,
  // because this runs inside `fold`: a renderer that throws on a shape the
  // model sent is a run that can never be projected again, and on the first
  // gated review on the pi harness it was also a process that died mid-turn
  // and could not rehydrate. The renderer is defensive on its own side too;
  // this is the belt to that brace, and the fallback is the model's own body.
  let composedBody = body;
  let comments: ReviewComment[] = sent;
  try {
    composedBody = renderReviewBody(input, { tool: reviewTool, runUrl: null });
    if (sent.length === 0) comments = reviewComments(input);
  } catch {
    // Fell back to the raw body and the comments the model sent, if any.
  }
  return { tool: reviewTool, toolCallId: call.id, body, composedBody, comments, findings };
}

/**
 * Fold an ordered list of events into a projection. Pure: the same events give
 * the same projection, so rehydration after a restart is a replay.
 */
export function fold(events: readonly Event[], options: FoldOptions = {}): Projection {
  const p = emptyProjection();
  const messages = new Map<string, ModelMessageEvent>();
  // Review calls parsed off `model.message`, waiting for their response. The
  // call carries the arguments and the response carries the outcome, and only
  // the pair is a posted review.
  const pendingReviews = new Map<string, DraftedReview>();
  let postFailure: string | null = null;
  const diff = options.mode === "diff";

  for (const event of events) {
    switch (event.type) {
      case "turn.created": {
        if (!p.turnIds.includes(event.turnId)) p.turnIds.push(event.turnId);
        // The run's first turn, not its latest: a turn retried adds another,
        // and the setup window belongs to the first.
        p.setup.turnCreatedAt ??= event.createdAt;
        break;
      }
      case "model.message": {
        // Counted before the map is written, so the same event arriving twice
        // adds once. The runner dedupes by id and `hydrate` replaces by id, so
        // today's input is already unique — but a sum that depends on a
        // caller's invariant is a sum that silently doubles the day it changes.
        const fresh = !messages.has(event.id);
        if (fresh && event.usage) {
          const check = p.checks.find((c) => c.threadId === event.threadId);
          if (check) {
            check.usage ??= emptyUsage();
            addMessageUsage(check.usage, event.usage);
          }
        }
        messages.set(event.id, event);
        if (event.threadId === "main") {
          p.setup.agentStartedAt ??= event.createdAt;
          // The round trips setup cost. Counted only until the first check
          // exists, and only for an id not seen before — the same dedupe the
          // usage sum above needs, for the same reason.
          if (fresh && p.setup.firstCheckAt === null) p.setup.messages += 1;
          for (const call of event.toolCalls ?? []) {
            const review = parseReview(call);
            if (review) pendingReviews.set(call.id, review);
          }
          const text = messageText(event);
          if (text && !(event.toolCalls?.length ?? 0)) p.summary = text;
        }
        break;
      }
      case "thread.created": {
        if (p.checks.some((c) => c.threadId === event.threadId)) break;
        const isCheck = (CHECK_NAMES as readonly string[]).includes(event.title as CheckName);
        // Which attempt at this check's name this thread is. A second thread
        // with the same title is the rubric respawning a sub-agent that came
        // back with an error instead of a report (decision 108), and the count
        // is the only record of it: the first thread's own state says it failed
        // and nothing else would say the run tried again.
        const attempts = p.checks.filter((c) => c.title === event.title).length + 1;
        p.checks.push({
          threadId: event.threadId,
          title: event.title,
          isCheck,
          status: "running",
          report: null,
          error: null,
          startedAt: event.createdAt ?? null,
          endedAt: null,
          attempts,
        });
        // Setup ends at the first thread the rubric named for a check, and not
        // at any thread: a helper subagent spawned mid-setup would otherwise
        // close the window early and report a setup that never happened.
        if (isCheck && p.setup.firstCheckAt === null) {
          p.setup.firstCheckAt = event.createdAt ?? null;
          settleSetup(p.setup);
        }
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
        p.findings = mergeFindings(p.hardRuleHits, agentFindings(p.review));
        break;
      }
      case "tool.approval_required": {
        // Nothing is gated on any spec since decision 138, so a held call is a
        // session pinned to an older spec (decision 16) or a registration
        // nobody meant. Either way the turn is suspended waiting for an answer
        // nothing will send: the run ends here rather than sitting `running`
        // until the watchdog, and the message names the call so the log says
        // which spec still asks. Not retried (the same spec asks again).
        const call = event.toolCalls[0];
        const source = call ? messages.get(call.sourceEventId) : undefined;
        const name = source?.toolCalls?.find((c) => c.id === call?.id)?.function.name ?? "a tool";
        p.status = "error";
        p.error = `approval requested for ${name}; nothing is gated on this spec`;
        break;
      }
      case "tool.response": {
        // How long the sandbox took to provision, read off `sandbox_create`'s
        // own answer (decision 115). `sandbox.created` was a harness event and
        // the harness stopped provisioning, so without this the board's setup
        // breakdown loses the one span that was never the agent thinking — and
        // `docs/spec.md` documents a null there as meaning the sandbox already
        // existed, which would have become a lie on every run.
        //
        // First writer wins, like `sandboxCreatedAt` above: a second
        // `sandbox_create` in one run is a second box, and the first one is the
        // run's. Read leniently, because this is a tool result and a number that
        // is not a number is simply not recorded.
        if (p.setup.sandboxProvisionedMs === undefined) {
          const ms = provisionedMs(event.content);
          if (ms !== undefined) p.setup.sandboxProvisionedMs = ms;
        }
        // The review, once GitHub has answered. A refused post leaves
        // `review` null and the refusal in hand for the ladder: the pull
        // request carries nothing, so the run must not say it does. A later
        // call that succeeds records its review and the earlier refusal no
        // longer matters.
        const drafted = pendingReviews.get(event.toolCallId);
        if (drafted) {
          pendingReviews.delete(event.toolCallId);
          if (event.isError) {
            postFailure = postFailureText(event.toolName, event.content);
          } else {
            p.review = drafted;
            postFailure = null;
          }
        }
        break;
      }
      case "turn.done": {
        // Before the status ladder below, which `break`s out of this case in
        // half a dozen places: what the turn cost is true whichever way it
        // ended, and an error turn is exactly the one whose cost is worth
        // seeing — a turn the budget ended most of all (decision 132). Every
        // finished state carries metrics; a turn from before they did has none.
        if (event.state.metrics) addTurnMetrics(p.usage, event.state.metrics);
        // The turn is over, so a check that never arrived is missing for good.
        // A diff run had no checks to wait for: nothing is missing from it.
        p.findings = mergeFindings(
          [...p.hardRuleHits, ...(diff ? [] : missingCheckFindings(p.checks))],
          agentFindings(p.review),
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
        if (diff) {
          // The diff review's own ladder (decision 136), shorter than the
          // sandbox one below because it can reach fewer places: it has no
          // hard rule and no check. One tool is permitted. The other review
          // tool is the model claiming evidence it does not have, and the
          // review is already on the pull request by the time this runs, so
          // the run says so rather than calling it clean. A `critical` on the
          // advisory is the same claim and lands on the same rung the sandbox
          // ladder has for it.
          const other = p.review?.tool !== "post_advisory_review" ? p.review?.tool : undefined;
          if (other) {
            p.status = "error";
            p.error = `diff review called ${other}; only post_advisory_review may post`;
          } else if (p.review && p.findings.some((f) => f.severity === "critical")) {
            const titles = p.findings.filter((f) => f.severity === "critical").map((f) => f.title);
            p.status = "error";
            p.error = `critical finding (${titles.join("; ")}) but the agent posted an advisory review`;
          } else if (p.review) {
            // Not `unproven`: a diff run never had evidence to post and says
            // so on its record's `mode`, which is the field a list reads.
            p.status = "clean";
          } else {
            p.status = "error";
            p.error = postFailure ?? "turn ended without a review";
          }
          break;
        }
        if (p.review?.tool === "post_blocking_review") {
          // Cujo blocked the merge: REQUEST_CHANGES is on the pull request and
          // the check run fails on its head (decision 138). Nobody was asked,
          // and a person lifts it with `/cujo dismiss`, which moves the row
          // from outside the fold — no event says a block was lifted.
          p.status = "blocked";
        } else if (
          p.review?.tool === "post_advisory_review" &&
          p.findings.some((f) => f.severity === "critical")
        ) {
          // Posted an advisory despite a critical, a hard rule's or its own.
          // The advisory has already posted, so the contradiction is recorded
          // rather than hidden behind `clean`; the rules are re-derived here
          // for exactly this (decision 21), and nothing can be prevented.
          const titles = (list: readonly Finding[]) => list.map((f) => f.title).join("; ");
          p.status = "error";
          p.error =
            p.hardRuleHits.length > 0
              ? `hard rule tripped (${titles(p.hardRuleHits)}) but the agent posted an advisory review`
              : `critical finding (${titles(
                  p.findings.filter((f) => f.severity === "critical"),
                )}) but the agent posted an advisory review`;
        } else if (p.review && !p.checks.some((c) => c.isCheck && c.report !== null)) {
          // Posted a review with no evidence behind it. Above `clean` and below
          // every contradiction rung, so it can never mask one: a run that
          // blocked still says so, and only a run with nothing left to say
          // lands here. Coverage is not a finding, because every
          // operational rule is a `warn` and no `warn` moves the status — which
          // is why `check_missing` firing four times still folded `clean`.
          p.status = "unproven";
        } else if (p.review) {
          p.status = "clean";
        } else {
          // A turn that never called a review tool posted nothing; calling
          // that clean would hide a broken github-mcp registration. A turn
          // whose call GitHub refused posted nothing either, and says why.
          p.status = "error";
          p.error = postFailure ?? "turn ended without a review";
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
 * would start a new turn for a run somebody had just superseded if the
 * wording ever changed.
 */
export function lastTurnOutcome(events: readonly Event[]): "done" | "error" | "cancelled" | null {
  let outcome: "done" | "error" | "cancelled" | null = null;
  for (const event of events) {
    if (event.type !== "turn.done") continue;
    outcome = event.state.status;
  }
  return outcome;
}
