/**
 * Where a link to a run points. Pure: two rules, no I/O, no config reading.
 *
 * The two questions here used to have different answers. A Discord card asked
 * "where does this run live for the people in this channel", and there was
 * always some page — the gated operator UI, if nothing else. A pull request
 * review asked "is there a page a stranger could open", and the answer was
 * sometimes nothing at all.
 *
 * Since decision 57 there is no gated UI, so both questions have the same
 * answer and the functions differ only in whether they know the host.
 * `publicRunId` deliberately still does not consult `publicBaseUrl`: whether a
 * board exists is `github-mcp`'s half of the question (decision 36), and each
 * side owns the half it can actually answer. They are kept apart so the next
 * person who needs a run link cannot quietly give one of them the other's rule.
 */

/** The one origin there is, since decision 57. Empty means no link anywhere. */
export interface UiLinks {
  /** The anonymous board. Empty when none is configured. */
  publicBaseUrl: string;
}

/**
 * A card links to the board when the run is public, and to nothing when it is
 * not (decision 57).
 *
 * A private run has no page: the board serves public repos only, and there is
 * no second, gated hostname to fall back to any more. A card whose title is not
 * a hyperlink is the honest rendering of that — better than a link into a 404,
 * and better than naming a private repo's run somewhere it cannot be read.
 * The pull request is where that run is actually discussed.
 */
export function runUrl(links: UiLinks, run: { id: string; isPublic: boolean }): string | null {
  if (!run.isPublic || !links.publicBaseUrl) return null;
  return `${links.publicBaseUrl}/runs/${run.id}`;
}

/**
 * The pull request a run is about, as a URL. Structural, not derived: the repo
 * reached the store through a GitHub event and was validated again when the
 * channel was bound, and the number is a number — the same argument rule 8
 * makes for Cujo's own link. On a private run's card it is the only live link
 * there is, because the title does not point at a page that run has none of
 * (decision 57).
 */
export function pullRequestUrl(run: { repo: string; prNumber: number }): string {
  return `https://github.com/${run.repo}/pull/${run.prNumber}`;
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
 * The rule is the same one `runUrl` now applies, reached from the other end. A
 * review is read by anyone who can see the pull request, including people who
 * have never heard of Cujo, so the only link worth putting there is one that
 * opens for all of them — and a private run has no such page. This
 * deliberately does not consult `publicBaseUrl`: whether a board exists is
 * `github-mcp`'s half of the question, and each side owns the half it can
 * actually answer.
 */
export function publicRunId(run: { id: string; isPublic: boolean }): string {
  return run.isPublic ? run.id : "";
}
