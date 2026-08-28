/**
 * Where a link to a run points. Pure: two rules, no I/O, no config reading.
 *
 * There are two different questions here and they have different answers. A
 * Discord card asks "where does this run live for the people in this channel",
 * and the answer is always some page. A pull request review asks "is there a
 * page a stranger could open", and the answer is sometimes nothing at all.
 * Keeping both in one file is what stops the second from drifting into the
 * first the next time someone needs a run link.
 */

/** Where the two hostnames live, since a link has to choose between them. */
export interface UiLinks {
  /** The Access-gated operator UI, where a decision is actually made. */
  uiBaseUrl: string;
  /** The anonymous board. Empty falls back to the operator UI. */
  publicBaseUrl: string;
}

/**
 * A card links to the public board when the run is public, and to the operator
 * UI when it is not (decision 34).
 *
 * A repo's Discord channel holds its team, not Cujo's operators, and most of
 * them cannot pass Access — pointing every card at the gated hostname would
 * answer them with a login page. The public run page carries its own link on to
 * `cujo-admin` when a decision is pending, so an approver is one click further
 * and nobody else is stopped. A private repo has no public page, so its cards
 * have only the one place to go.
 */
export function runUrl(links: UiLinks, run: { id: string; isPublic: boolean }): string {
  const base = run.isPublic && links.publicBaseUrl ? links.publicBaseUrl : links.uiBaseUrl;
  return `${base}/runs/${run.id}`;
}

/**
 * The run id to put in a pull request review, or `""` when the review should
 * carry no link at all (decision 36).
 *
 * An id and not a URL, because the value travels through the agent and the
 * agent has just read a stranger's pull request. `github-mcp` holds the host
 * and builds the link, so the worst a redirected agent can do is name a
 * different run on Cujo's own board rather than send readers somewhere else
 * entirely.
 *
 * The rule is stricter than `runUrl`'s. A review is read by anyone who can see
 * the pull request, including people who have never heard of Cujo, so the only
 * link worth putting there is one that opens for all of them — and a private
 * run has no such page. This deliberately does not consult `publicBaseUrl`:
 * whether a board exists is `github-mcp`'s half of the question, and each side
 * owns the half it can actually answer.
 */
export function publicRunId(run: { id: string; isPublic: boolean }): string {
  return run.isPublic ? run.id : "";
}
