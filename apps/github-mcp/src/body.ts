/**
 * The parts of a review body this server writes itself (decision 36).
 *
 * The agent supplies prose and a URL; it never supplies a format. That is the
 * whole point of putting the footer here rather than in `agent/SKILL.md`: a
 * model asked to end its body with a particular line can forget it, reword it,
 * or put it above the Egress section, and none of those failures are visible
 * until someone reads a posted review. Composed here it is either correct or
 * absent, and absent only when Cujo says so.
 */

/**
 * Append the link to the run's public page, when there is one.
 *
 * `runUrl` is undefined for a private repository, which has no page a reader of
 * the pull request could open, so its review is left byte-identical to what it
 * was before this existed.
 */
export function appendRunFooter(body: string, runUrl: string | undefined): string {
  if (!runUrl) return body;
  return `${body.trimEnd()}\n\n---\n\nFull evidence: ${runUrl}\n`;
}
