/**
 * Who may lift a block from the pull request (decisions 44, 138).
 *
 * Pure, and separate from the read that feeds it, because this is the policy
 * and `GitHubReader.permissionFor` is only the fact. The policy is short enough
 * to read in one sitting, which is the point: it is the whole answer to "who is
 * allowed to unlock a merge Cujo blocked, under the bot's name".
 */

/**
 * The two verbs. Two is the entire learning surface, on purpose.
 *
 * `dismiss` lifts a block, which is the one human decision in the design.
 * `review` asks Cujo to look again, and carries the same principal anyway,
 * because it provisions a sandbox and a model turn — a cost a stranger should
 * not be able to impose on somebody else's repository from a comment box.
 */
export type CommandVerb = "dismiss" | "review";

/** What `GitHubReader.permissionFor` answers. */
export type RepoPermission = "admin" | "write" | "read" | "none" | "unknown";

export type CommandAuthorization =
  | { allowed: true }
  | {
      allowed: false;
      reason: "bot_may_not_decide" | "not_a_maintainer" | "author_may_not_dismiss" | "unknown";
    };

/**
 * GitHub logins are case-insensitive, and the two sides of this comparison come
 * from different payload fields, so a mismatch in casing must not be read as a
 * different person.
 */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The rule, in order.
 *
 * 1. **A Bot account may not `dismiss`.** The unlock exists to be the one
 *    thing a coding agent cannot do to the block it earned (decision 138): a
 *    GitHub App's installation account with write access is exactly the
 *    principal that would otherwise lift its own block. Checked first and
 *    without a GitHub read, from the `type` the webhook payload carries.
 *    `review` by a bot is allowed — asking to be looked at again buries
 *    nothing, and a bot with write is paying for its own repository's turn.
 * 2. **Repo write or admin.** Repo write is a *broader* principal than an
 *    Access email, not a stronger one, and that is accepted deliberately: it is
 *    the authority that actually correlates with owning the repository, it is
 *    self-serve, and it is revoked the same way it is granted. The same
 *    argument decision 31 made for `.cujo.yml`.
 * 3. **`unknown` is not a refusal, and not permission either.** A caller that
 *    gets it says "I could not check, try again" — never "you may not", which
 *    would be a claim about a person that GitHub never made.
 * 4. **The pull request's author may not `dismiss`.** Not optional, and the
 *    reason the whole product exists: the scenario is hostile code in a pull
 *    request, and repo write includes whoever opened it. `dismiss` is the
 *    direction that lifts a block on one's own change, so it is refused by
 *    name. `review` by the author is fine: asking to be looked at again is
 *    not a way to bury anything.
 */
export function authorizeCommand(input: {
  verb: CommandVerb;
  permission: RepoPermission;
  actor: string;
  actorIsBot: boolean;
  prAuthor: string;
}): CommandAuthorization {
  if (input.verb === "dismiss" && input.actorIsBot) {
    return { allowed: false, reason: "bot_may_not_decide" };
  }
  if (input.permission === "unknown") return { allowed: false, reason: "unknown" };
  if (input.permission !== "admin" && input.permission !== "write") {
    return { allowed: false, reason: "not_a_maintainer" };
  }
  if (input.verb === "dismiss" && sameLogin(input.actor, input.prAuthor)) {
    return { allowed: false, reason: "author_may_not_dismiss" };
  }
  return { allowed: true };
}
