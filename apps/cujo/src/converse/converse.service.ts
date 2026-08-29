/**
 * Answering `@cujo-guard` on a pull request (Design 3, decision 46).
 *
 * The load-bearing rule is that **conversation runs in its own TrueForge
 * session and is never folded into a run.** A second turn on the review's
 * session fails three separate ways: it silently cancels a live review, it is
 * refused with a 422 in exactly the `blocked_pending` state where a maintainer
 * most wants to talk, and it corrupts the projection, because `p.checks`
 * dedupes by thread id so a re-run emits every hard-rule critical twice and can
 * never clear the finding it was meant to correct.
 *
 * For the same reason this does not go through `Runner`. `Runner.refold` writes
 * the run's status unconditionally and emits on `changes`, which drives the
 * pull request reaction and the Discord card — so a conversation turn routed
 * through it could move a `clean` run to `error` and repaint the verdict.
 * The only thing shared with the reviewer is the harness client.
 *
 * **The agent holds no write authority at all.** Its spec has `mcpServers: []`,
 * and this service posts the reply from the turn's final assistant message
 * after the turn ends. So the worst a prompt injection through a stranger's
 * comment achieves is a wasted sandbox — and a turn that errors or times out
 * still answers the person, which a reply tool structurally cannot do.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { BOT_LOGIN } from "../clients/github";
import type { Harness, SessionEvent } from "../clients/trueforge";
import { messageText } from "../review/fold";
import { parseMention } from "../review/parse-command";
import type { CheckState, Finding, Projection } from "../review/types";
import type { RunStore } from "../store";
import type { ConverseRateLimit } from "./rate-limit";

/** What the reply is posted through, and where the question came from. */
export type ConverseSurface =
  | { kind: "issue" }
  /** A reply inside a review thread, which is a different GitHub endpoint. */
  | { kind: "review_thread"; commentId: number };

export interface ConverseGitHub {
  permissionFor(
    repo: string,
    login: string,
  ): Promise<"admin" | "write" | "read" | "none" | "unknown">;
  createComment(repo: string, prNumber: number, body: string): Promise<number>;
  replyToReviewComment(
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<number>;
}

export interface ConverseDeps {
  runs: RunStore;
  harness: Pick<Harness, "createSession" | "startTurn" | "subscribe" | "listEvents" | "cancelTurn">;
  github: ConverseGitHub;
  /** Built once at startup, like the review spec. */
  spec: TrueForgeApi.AgentSpec;
  limit: ConverseRateLimit;
  /** How long one answer may take before the person is told it did not finish. */
  turnTimeoutMs: number;
}

export interface ConverseRequest {
  repo: string;
  prNumber: number;
  /** The comment that mentioned Cujo, for the acknowledgement and the reply. */
  commentId: number;
  actor: string;
  body: string;
  surface: ConverseSurface;
  log: Logger;
}

type Outcome =
  | { kind: "ignored"; reason: "not_a_mention" | "own_comment" }
  | { kind: "refused"; reason: string; say: string }
  | { kind: "answered" };

const NOT_A_MAINTAINER =
  "I only answer questions from people with write access to this repository, because answering one means running your pull request in a sandbox. Every finding above is readable by anyone.";
const UNKNOWN_PERMISSION =
  "I could not check your access with GitHub just now, so I have not run anything. Try again in a moment.";
const NO_RUN = "I have not reviewed this pull request, so there is nothing for me to explain yet.";
const IN_FLIGHT =
  "I am still working on the last question on this pull request. Ask again once I have answered it.";
const BROKE =
  "Something broke while I was working on that, and it was not your comment. Nothing changed.";

function tooMany(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `I have answered as many questions as I will on this pull request for now — each one runs it in a sandbox. Ask again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** A check report, trimmed to what a question can be answered from. */
function briefCheck(check: CheckState): Record<string, unknown> {
  return { name: check.title, status: check.status, report: check.report, error: check.error };
}

function briefFinding(finding: Finding): Record<string, unknown> {
  return {
    source: finding.source,
    check: finding.check,
    severity: finding.severity,
    title: finding.title,
    evidence: finding.evidence,
    ...(finding.rule ? { rule: finding.rule } : {}),
  };
}

export class ConverseService {
  constructor(private readonly deps: ConverseDeps) {}

  /**
   * Never throws. The delivery is answered 200 before this runs, so a throw
   * here is a person waiting on a reply that never comes.
   */
  async handle(request: ConverseRequest): Promise<void> {
    let outcome: Outcome;
    try {
      outcome = await this.answer(request);
    } catch (error) {
      request.log.error("converse.failed", {
        repo: request.repo,
        pr_number: request.prNumber,
        comment_id: String(request.commentId),
        error_kind: error instanceof Error ? error.name : "unknown",
      });
      outcome = { kind: "refused", reason: "internal_error", say: BROKE };
    }
    if (outcome.kind === "ignored") return;
    if (outcome.kind === "refused") {
      request.log.info("converse.refused", {
        repo: request.repo,
        pr_number: request.prNumber,
        comment_id: String(request.commentId),
        actor: request.actor,
        reason: outcome.reason,
      });
      await this.say(request, outcome.say);
    }
  }

  private async answer(request: ConverseRequest): Promise<Outcome> {
    // Cujo's own replies are comments on the pull request too, and a reply can
    // quote the question it answers. Without this, one mention is a loop.
    if (request.actor === BOT_LOGIN) return { kind: "ignored", reason: "own_comment" };

    const question = parseMention(request.body);
    if (!question) return { kind: "ignored", reason: "not_a_mention" };

    const run = this.deps.runs.latestRunForPr(request.repo, request.prNumber);
    if (!run) return { kind: "refused", reason: "no_run", say: NO_RUN };

    // Before the rate limit, so a stranger cannot spend a maintainer's budget.
    const permission = await this.deps.github.permissionFor(request.repo, request.actor);
    if (permission === "unknown") {
      return { kind: "refused", reason: "unknown", say: UNKNOWN_PERMISSION };
    }
    if (permission !== "admin" && permission !== "write") {
      return { kind: "refused", reason: "not_a_maintainer", say: NOT_A_MAINTAINER };
    }

    const verdict = this.deps.limit.take(request.repo, request.prNumber);
    if (!verdict.allowed) {
      return verdict.reason === "in_flight"
        ? { kind: "refused", reason: "in_flight", say: IN_FLIGHT }
        : { kind: "refused", reason: "too_many", say: tooMany(verdict.retryAfterMs) };
    }

    try {
      const projection = this.deps.runs.getProjection(run.id);
      const sessionId = await this.session(request);
      const message = this.brief(request, run.headSha, projection, question);
      request.log.info("converse.started", {
        repo: request.repo,
        pr_number: request.prNumber,
        comment_id: String(request.commentId),
        actor: request.actor,
        session_id: sessionId,
        run_id: run.id,
      });
      const reply = await this.runTurn(request, sessionId, message);
      await this.say(request, reply);
      request.log.info("converse.answered", {
        repo: request.repo,
        pr_number: request.prNumber,
        comment_id: String(request.commentId),
        session_id: sessionId,
      });
      return { kind: "answered" };
    } finally {
      this.deps.limit.release(request.repo, request.prNumber);
    }
  }

  /** Find or create this pull request's conversation session. First writer wins. */
  private async session(request: ConverseRequest): Promise<string> {
    const existing = this.deps.runs.getConversationSession(request.repo, request.prNumber);
    if (existing) return existing;
    const created = await this.deps.harness.createSession(this.deps.spec);
    return this.deps.runs.putConversationSession(request.repo, request.prNumber, created);
  }

  /**
   * The curated brief: the run's own evidence, plus the question.
   *
   * Not the review session's history, which is both larger and unreadable —
   * everything worth answering from is already in the projection, and a payload
   * a person can review is worth more than one that is merely complete.
   */
  private brief(
    request: ConverseRequest,
    headSha: string,
    projection: Projection | null,
    question: string,
  ): string {
    const payload = {
      repo: request.repo,
      pr_number: request.prNumber,
      head_sha: headSha,
      clone_url: `https://github.com/${request.repo}.git`,
      run_status: projection?.status ?? "unknown",
      checks: (projection?.checks ?? []).filter((c) => c.isCheck).map(briefCheck),
      findings: (projection?.findings ?? []).map(briefFinding),
      review_body: projection?.review?.body ?? null,
      question,
    };
    return `Answer this question about the review. Input:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  }

  /**
   * Run one turn and return what to post.
   *
   * Its own timeout and its own drain loop, small because it has to be: this
   * cannot reuse `Runner.consume`, which folds into a run. A turn that times
   * out or errors still produces a sentence — the person asked a question and
   * silence is the one answer that is never right.
   */
  private async runTurn(
    request: ConverseRequest,
    sessionId: string,
    message: string,
  ): Promise<string> {
    let turnId: string;
    try {
      turnId = await this.deps.harness.startTurn(sessionId, message);
    } catch (error) {
      request.log.warn("converse.turn.failed", {
        session_id: sessionId,
        ...errorFields(error),
      });
      return "I could not start a sandbox to answer that. Ask again and I will try once more.";
    }
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      void this.deps.harness.cancelTurn(sessionId).catch(() => {});
    }, this.deps.turnTimeoutMs);
    try {
      const stream = await this.deps.harness.subscribe(sessionId, turnId);
      for await (const event of stream) {
        if (event.type === "turn.done") break;
      }
    } catch (error) {
      request.log.warn("converse.stream.dropped", { session_id: sessionId, ...errorFields(error) });
    } finally {
      clearTimeout(deadline);
    }
    if (timedOut) {
      request.log.warn("converse.turn.timeout", {
        session_id: sessionId,
        timeout_ms: this.deps.turnTimeoutMs,
      });
      return "I ran out of time working on that. Ask again if it is still worth answering.";
    }
    const text = await this.finalMessage(sessionId, turnId);
    return text ?? "I did not get to an answer on that one, and I would rather say so than guess.";
  }

  /**
   * The last thing the agent said, from the persisted events.
   *
   * `listEvents` and not the stream: the streamed `model.message` is a stub
   * without content, so the text only exists on the persisted copy. The reply
   * is the last message on `main` that carries text and calls no tool, which is
   * the same rule `fold` uses to pick a run's summary.
   */
  private async finalMessage(sessionId: string, turnId: string): Promise<string | null> {
    let items: { turnId: string; event: SessionEvent }[];
    try {
      items = await this.deps.harness.listEvents(sessionId);
    } catch {
      return null;
    }
    let text: string | null = null;
    for (const item of items) {
      if (item.turnId !== turnId) continue;
      const event = item.event;
      if (event.type !== "model.message" || event.threadId !== "main") continue;
      if (event.toolCalls?.length) continue;
      const candidate = messageText(event).trim();
      if (candidate) text = candidate;
    }
    return text;
  }

  /** The reply goes back to the surface the question came from. */
  private async say(request: ConverseRequest, body: string): Promise<void> {
    try {
      if (request.surface.kind === "review_thread") {
        await this.deps.github.replyToReviewComment(
          request.repo,
          request.prNumber,
          request.surface.commentId,
          body,
        );
        return;
      }
      await this.deps.github.createComment(request.repo, request.prNumber, body);
    } catch (error) {
      // There is no surface left to apologise on, so this only gets a line.
      request.log.error("converse.reply.failed", {
        repo: request.repo,
        pr_number: request.prNumber,
        comment_id: String(request.commentId),
        error_kind: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
