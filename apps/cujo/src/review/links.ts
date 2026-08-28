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
 * The public page for a run, or `""` when there is none (decision 36).
 *
 * This is the review footer's rule, and it is deliberately stricter than
 * `runUrl`. A pull request review is read by anyone who can see the pull
 * request, including people who have never heard of Cujo, so the only link
 * worth putting there is one that opens for all of them. The gated host would
 * answer with a login screen and the board root would answer with a page about
 * some other run; both are worse than saying nothing.
 *
 * Returning `""` rather than throwing is also the safe direction when
 * `CUJO_PUBLIC_BASE_URL` is unset in a deploy: every review quietly loses its
 * footer instead of every review failing to post.
 */
export function publicRunUrl(links: UiLinks, run: { id: string; isPublic: boolean }): string {
  return run.isPublic && links.publicBaseUrl ? `${links.publicBaseUrl}/runs/${run.id}` : "";
}
