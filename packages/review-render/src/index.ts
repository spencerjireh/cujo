/**
 * How a Cujo review reads (decision 74).
 *
 * A package rather than a module inside `apps/github-mcp`, because two
 * processes have to agree on the answer and neither may ask the other. The
 * server composes the body it posts to GitHub; `apps/cujo` reproduces the same
 * body and the same inline comments for the run board, from the same tool-call
 * arguments. Pure functions with no IO, no config, and no knowledge of either
 * caller — sharing this is not `apps/cujo` depending on the write-only server
 * (decision 5), it is both of them depending on one definition of the format.
 *
 * The first cut of decision 74 derived the comments twice, on the reasoning
 * that re-deriving is the trade decision 21 already takes for the hard rules.
 * That was wrong, and the review caught it: the hard rules are a *judgment*
 * the trusted side must reach independently, while this is a *format* both
 * sides must agree on exactly. Two implementations of one format is drift with
 * extra steps, and three of the first review's findings were that drift —
 * a dedupe key missing `check`, a title translated on one side only, and a
 * board showing a one-sentence lede where GitHub had the whole review.
 */

export {
  type Coverage,
  type EgressHost,
  type RenderFinding,
  type RenderInput,
  type RenderOptions,
  type ReviewComment,
  type ReviewTool,
  type Severity,
  type Side,
  type Verdict,
  type Counts,
  commentBody,
  renderReviewBody,
  reviewComments,
  safeText,
  severityCounts,
  verdictOf,
} from "./render";
export { type PlainTitle, plainTitle } from "./plain-title";
