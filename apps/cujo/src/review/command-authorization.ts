/**
 * Who may decide a held accusation from the pull request (Design 2).
 *
 * Pure, and separate from the read that feeds it, because this is the policy
 * and `GitHubReader.permissionFor` is only the fact. The policy is short enough
 * to read in one sitting, which is the point: it is the whole answer to "who is
 * allowed to publish a public accusation naming a third party under the bot's
 * name".
 */

/** The two verbs. Two is the entire learning surface, on purpose. */
export type CommandVerb = "confirm" | "dismiss";

/** What `GitHubReader.permissionFor` answers. */
export type RepoPermission = "admin" | "write" | "read" | "none" | "unknown";

export type CommandAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "not_a_maintainer" | "author_may_not_dismiss" | "unknown" };

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
 * 1. **Repo write or admin.** Repo write is a *broader* principal than an
 *    Access email, not a stronger one, and that is accepted deliberately: it is
 *    the authority that actually correlates with owning the repository, it is
 *    self-serve, and it is revoked the same way it is granted. The same
 *    argument decision 31 made for `.cujo.yml`.
 * 2. **`unknown` is not a refusal, and not permission either.** A caller that
 *    gets it says "I could not check, try again" — never "you may not", which
 *    would be a claim about a person that GitHub never made.
 * 3. **The pull request's author may not `dismiss`.** Not optional, and the
 *    reason the whole product exists: the scenario is hostile code in a pull
 *    request, and repo write includes whoever opened it. A denied gate posts
 *    nothing, so `dismiss` is the direction that buries an accusation against
 *    one's own change. `confirm` by the author is fine — acting against your own
 *    interest needs no guard.
 */
export function authorizeCommand(input: {
  verb: CommandVerb;
  permission: RepoPermission;
  actor: string;
  prAuthor: string;
}): CommandAuthorization {
  if (input.permission === "unknown") return { allowed: false, reason: "unknown" };
  if (input.permission !== "admin" && input.permission !== "write") {
    return { allowed: false, reason: "not_a_maintainer" };
  }
  if (input.verb === "dismiss" && sameLogin(input.actor, input.prAuthor)) {
    return { allowed: false, reason: "author_may_not_dismiss" };
  }
  return { allowed: true };
}
