/**
 * `/cujo confirm` and `/cujo dismiss`, from a pull request comment (Design 2).
 *
 * This is the human gate. The turn is paused on a `post_gated_review` call and
 * nothing reaches the pull request until somebody answers, so every decision
 * made here is made in the trusted plane on an HMAC-verified delivery, and none
 * of it is made by a model.
 *
 * **Every outcome speaks.** The operator UI at least surfaced a 409; a comment
 * that is silently ignored is indistinguishable from a webhook that never
 * arrived, and the person who typed the command has no way to tell which
 * happened. So each refusal names itself and says what to do instead — the same
 * rule `notify/authorization.ts` follows for Discord.
 */

import type { Logger } from "@cujo/log";
import { BOT_LOGIN as DEFAULT_BOT_LOGIN } from "../clients/github";
import type { Reaction } from "../clients/github-reactions";
import type { RunStore } from "../store/runs";
import { type CommandVerb, authorizeCommand } from "./command-authorization";
import { parseCommand } from "./parse-command";
import type { ApproveResult, Runner } from "./runner.service";

/** The reads and writes this needs, named so the tests can be plain objects. */
export interface PrCommandGitHub {
  pullRequestHead(
    repo: string,
    prNumber: number,
  ): Promise<{ headSha: string; author: string } | null>;
  permissionFor(
    repo: string,
    login: string,
  ): Promise<"admin" | "write" | "read" | "none" | "unknown">;
  createComment(repo: string, prNumber: number, body: string): Promise<number>;
}

export interface PrCommandReactions {
  addToComment(repo: string, commentId: number, content: Reaction): Promise<void>;
}

export interface PrCommandDeps {
  runs: RunStore;
  runner: Pick<Runner, "approve">;
  github: PrCommandGitHub;
  reactions: PrCommandReactions | null;
  botLogin?: string;
  /**
   * Starts a fresh review of a head, for `/cujo review`.
   *
   * A callback rather than the store, the harness and the GitHub reader all
   * reached for from in here: claiming a run needs the same pieces the webhook
   * route already holds, and pulling them into this file would turn a policy
   * module a plain object can test into a second composition root. Absent means
   * the verb is off, which is what a deployment without it answers.
   */
  startReview?: (input: {
    repo: string;
    prNumber: number;
    headSha: string;
    actor: string;
  }) => Promise<{ ok: true } | { ok: false; detail: string }>;
}

export interface PrCommand {
  repo: string;
  prNumber: number;
  commentId: number;
  /** The comment's author, from the HMAC-verified payload. */
  actor: string;
  body: string;
  log: Logger;
}

/**
 * Why a command did not become a decision. `ignored` is the only one that says
 * nothing on the pull request: it means the comment was not addressed to Cujo.
 */
type Outcome =
  | { kind: "ignored"; reason: "not_a_command" | "own_comment" }
  | { kind: "refused"; reason: string; say: string }
  | { kind: "decided"; verb: CommandVerb };

const SHORT = (sha: string) => sha.slice(0, 7);

export class PrCommandService {
  constructor(private readonly deps: PrCommandDeps) {}

  /**
   * Runs after the delivery has been answered, like `startRun`. Never throws:
   * a command that fails is a comment that gets an apology, not a 500 GitHub
   * will retry into a second decision.
   */
  async handle(command: PrCommand): Promise<void> {
    let outcome: Outcome;
    try {
      outcome = await this.decide(command);
    } catch (error) {
      command.log.error("comment.command.failed", {
        repo: command.repo,
        pr_number: command.prNumber,
        ...errorReason(error),
      });
      outcome = {
        kind: "refused",
        reason: "internal_error",
        say: "Something broke while I was answering that. Nothing was decided.",
      };
    }

    if (outcome.kind === "ignored") {
      command.log.debug("comment.ignored", {
        repo: command.repo,
        pr_number: command.prNumber,
        reason: outcome.reason,
      });
      return;
    }

    const seen = {
      repo: command.repo,
      pr_number: command.prNumber,
      comment_id: String(command.commentId),
      actor: command.actor,
    };
    if (outcome.kind === "decided") {
      command.log.info("comment.command.applied", { ...seen, decision: outcome.verb });
    } else {
      command.log.warn("comment.command.refused", { ...seen, reason: outcome.reason });
    }

    // Both of these are best effort and in this order. The reply is what the
    // person is waiting for; the reaction is decoration, and a failed
    // decoration must not swallow the answer.
    await this.say(command, outcome.kind === "decided" ? applied(outcome.verb) : outcome.say);
    await this.react(command, outcome.kind === "decided" ? "+1" : "confused");
  }

  private async decide(command: PrCommand): Promise<Outcome> {
    // Cujo's own replies contain the verbs — `applied()` below prints them, and
    // a review body can quote them — so without this a reply re-triggers itself.
    if (command.actor === (this.deps.botLogin ?? DEFAULT_BOT_LOGIN))
      return { kind: "ignored", reason: "own_comment" };

    const parsed = parseCommand(command.body);
    if (parsed.kind === "none") return { kind: "ignored", reason: "not_a_command" };
    if (parsed.kind === "ambiguous") {
      return refuse("ambiguous", "That comment gives more than one command. Say one.");
    }
    const { verb } = parsed;

    // `review` asks for a run rather than answering one, so it takes its own
    // path from here. Everything below assumes a run exists to decide about,
    // and the pull request this verb is most useful on is the one Cujo has
    // never seen: opened before the App was installed, or one whose run the
    // already-reviewed guard deleted.
    if (verb === "review") return this.startReview(command);

    // Cheap and local: a comment on a pull request Cujo never touched is the
    // common case on a busy repo, and it costs no GitHub call to say so.
    const known = this.deps.runs.latestRunForPr(command.repo, command.prNumber);
    if (!known) {
      return refuse(
        "no_run",
        "I have not reviewed this pull request, so there is nothing to answer.",
      );
    }

    const permission = await this.deps.github.permissionFor(command.repo, command.actor);

    // Read last of the two, so this is the final `await` before the claim. A
    // comment names a pull request, never a commit, and a push between the
    // reading and the deciding is the whole hazard; nothing shortens the gap
    // further without a transaction spanning two systems.
    const head = await this.deps.github.pullRequestHead(command.repo, command.prNumber);
    if (!head) {
      return refuse("pr_unreadable", "I could not read this pull request just now. Try again.");
    }

    const auth = authorizeCommand({
      verb,
      permission,
      actor: command.actor,
      prAuthor: head.author,
    });
    if (!auth.allowed) return refuse(auth.reason, AUTHORIZATION_TEXT[auth.reason]);

    // The commit decides which run this answers, not the order the deliveries
    // happened to be inserted in. Read the block, push a fix, come back and
    // confirm, and the run for the old commit is refused by name.
    const run = this.deps.runs.runForPrHead(command.repo, command.prNumber, head.headSha);
    if (!run) {
      return refuse(
        "stale_head",
        `This pull request moved on since I last reviewed it: I have a run for \`${SHORT(known.headSha)}\`, and it is now on \`${SHORT(head.headSha)}\`. I am not answering an old commit's finding — decide on the run for the current commit once it finishes.`,
      );
    }

    const result = await this.deps.runner.approve(
      run.id,
      verb === "confirm" ? "allow" : "deny",
      `github:${command.actor}`,
    );
    if (!result.ok) return refuse(result.reason, approveText(result));
    return { kind: "decided", verb };
  }

  /**
   * `/cujo review`: look at the current head again, whatever is there now.
   *
   * The same principal as the other two verbs. It answers no question, so
   * none of the machinery below applies — no `latestRunForPr`, and above all no
   * `stale_head`, which exists to stop somebody answering an old commit's
   * finding. This verb *targets* whatever the head is now; being out of date is
   * the reason to run it, not a reason to refuse.
   *
   * Everything it needs beyond policy is one injected callback, so this file
   * stays a module a plain object can test.
   */
  private async startReview(command: PrCommand): Promise<Outcome> {
    if (!this.deps.startReview) {
      return refuse("review_unavailable", "I cannot start a review from a comment right now.");
    }
    const permission = await this.deps.github.permissionFor(command.repo, command.actor);
    const head = await this.deps.github.pullRequestHead(command.repo, command.prNumber);
    if (!head) {
      return refuse("pr_unreadable", "I could not read this pull request just now. Try again.");
    }
    const auth = authorizeCommand({
      verb: "review",
      permission,
      actor: command.actor,
      prAuthor: head.author,
    });
    if (!auth.allowed) return refuse(auth.reason, AUTHORIZATION_TEXT[auth.reason]);

    const result = await this.deps.startReview({
      repo: command.repo,
      prNumber: command.prNumber,
      headSha: head.headSha,
      actor: command.actor,
    });
    if (!result.ok) return refuse("review_failed", result.detail);
    return { kind: "decided", verb: "review" };
  }

  private async say(command: PrCommand, body: string): Promise<void> {
    try {
      await this.deps.github.createComment(command.repo, command.prNumber, body);
    } catch (error) {
      // There is no surface left to apologise on, so this only gets a line.
      command.log.error("comment.reply.failed", {
        repo: command.repo,
        pr_number: command.prNumber,
        ...errorReason(error),
      });
    }
  }

  private async react(command: PrCommand, content: Reaction): Promise<void> {
    if (!this.deps.reactions) return;
    try {
      await this.deps.reactions.addToComment(command.repo, command.commentId, content);
    } catch (error) {
      command.log.warn("comment.reaction.failed", {
        repo: command.repo,
        comment_id: String(command.commentId),
        ...errorReason(error),
      });
    }
  }
}

function refuse(reason: string, say: string): Outcome {
  return { kind: "refused", reason, say };
}

const APPLIED_TEXT: Record<CommandVerb, string> = {
  confirm: "Confirmed. The finding is now a blocking review on this pull request.",
  dismiss: "Dismissed. The observation stands, and the merge is not blocked.",
  // Says what it replaces, because it replaces more than a verdict: reclaiming
  // the head drops the old run's page and its Discord card along with it.
  review:
    "Reviewing this pull request again at its current commit. Any earlier run for that commit, and its evidence page, are replaced.",
};

function applied(verb: CommandVerb): string {
  return APPLIED_TEXT[verb];
}

const AUTHORIZATION_TEXT: Record<
  "not_a_maintainer" | "author_may_not_dismiss" | "unknown",
  string
> = {
  not_a_maintainer:
    "Answering a held finding needs write access to this repository. Everything I found is above, and anyone can read it.",
  author_may_not_dismiss:
    "You opened this pull request, so you cannot dismiss the finding against it. Anyone else with write access can — and you can `/cujo confirm` it.",
  unknown:
    "I could not check your access with GitHub just now, so I have not decided anything. Try again in a moment.",
};

/** One sentence per `ApproveRefusal`, because a comment has no 409 to show. */
function approveText(result: Extract<ApproveResult, { ok: false }>): string {
  switch (result.reason) {
    case "no_such_run":
      return "That run is gone. Push a commit to get a fresh review.";
    case "not_blocked_pending":
      return "Nothing is waiting on a human here right now.";
    case "already_decided":
      return "Somebody answered this one already.";
    case "resume_failed":
      return "I could not reach the harness to record that, so nothing changed. Try again in a moment.";
    default:
      return "I could not record that.";
  }
}

function errorReason(error: unknown): { reason: string } {
  return { reason: error instanceof Error ? error.name : "unknown" };
}
