/**
 * The parts of a review body this server writes itself (decision 36).
 *
 * The agent supplies neither the format nor the destination. That is the whole
 * point of composing the footer here: a model asked to end its body with a
 * particular line can forget it, reword it, or put it above the Egress section,
 * and a model asked for a URL can be talked into supplying someone else's by
 * the pull request it is reading. Composed here from a base URL this process
 * was configured with and a run id that must be a UUID, the footer is either
 * correct or absent, and it can only ever point at Cujo's own board.
 */

/** `randomUUID()` in `apps/cujo`, so anything else is not a run of ours. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Append the link to the run's public page, when there is one.
 *
 * Both halves must be present: `publicBaseUrl` is this deployment's board and
 * is empty when none is configured, and `runId` is absent for a private
 * repository, which has no page a reader of the pull request could open. With
 * either missing the body is left byte-identical to what it was before this
 * existed.
 */
export function appendRunFooter(
  body: string,
  publicBaseUrl: string,
  runId: string | undefined,
): string {
  if (!publicBaseUrl || !runId || !RUN_ID.test(runId)) return body;
  return `${body.trimEnd()}\n\n---\n\nFull evidence: ${publicBaseUrl}/runs/${runId}\n`;
}

/**
 * The prompt naming the two commands a maintainer can reply with.
 *
 * `/cujo confirm` and `/cujo dismiss` are this system's own commands, so the
 * sentence describing them belongs to it for the same reason the run link does.
 * The rubric used to quote it for the agent to reproduce, and the agent
 * reproduced it twice — on the observation, where it is true, and on the
 * accusation, where it asks for an approval that was granted before that call
 * could run at all. `post_gated_review` has no `accusation_follows` parameter,
 * so this cannot be reached from there.
 */
export function appendConfirmPrompt(body: string, accusationFollows: boolean): string {
  if (!accusationFollows) return body;
  return `${body.trimEnd()}\n\nThis matches a supply-chain pattern. Cujo will not publish that conclusion until a maintainer confirms. Reply \`/cujo confirm\` or \`/cujo dismiss\`.\n`;
}

/**
 * What this review is, so the same one is not posted twice.
 *
 * The three parts are each load-bearing:
 *
 * **The tool**, because the malice path posts two reviews on one head by
 * design — the observation and then the accusation — and when a run has both a
 * broken thing and a malice finding, both of those are `REQUEST_CHANGES`. A key
 * on the review event would refuse the second half of exactly the case the gate
 * exists for.
 *
 * **The head SHA**, because a new commit deserves a new review.
 *
 * **The run id**, because `/cujo review` asks for a second look at a head that
 * usually already has one. A re-review is a new run and so a new marker; a
 * model calling the same tool twice inside one turn carries the same run id
 * both times and is caught.
 *
 * Returns the empty string with no run id, which is a private repository
 * (decision 36) — and there the honest answer is that this server cannot tell
 * a duplicate from a re-review, so it does not guess. That is the same
 * duplicate exposure private repos had before this existed; it is not a new
 * one, and the alternative would be silently refusing `/cujo review` on them.
 *
 * An HTML comment, so no reader sees it. `parse-command.ts` drops any line
 * containing `<!--`, so it can never be read back as a `/cujo` command either.
 */
export function reviewMarker(tool: string, headSha: string, runId: string | undefined): string {
  if (!runId || !RUN_ID.test(runId)) return "";
  return `<!-- cujo:${tool}:${headSha}:${runId} -->`;
}

/** The marker on its own line, last, so it lands whether or not a footer did. */
export function appendReviewMarker(body: string, marker: string): string {
  if (!marker) return body;
  return `${body.trimEnd()}\n\n${marker}\n`;
}
