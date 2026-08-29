/**
 * The public wire shape (decision 34).
 *
 * Built field by field from an allowlist, never by removing fields from the
 * operator serializer. The difference is the default: a redaction like
 * `{ approver, ...rest }` publishes every field added to `Projection` from then
 * on, while construction names what may be seen and so publishes nothing new
 * until somebody writes it down. Nothing in this file may import from
 * `../operator/`.
 *
 * `PUBLIC_SOURCE_FIELDS` and `WITHHELD_SOURCE_FIELDS` together must cover every
 * key of `RunRecord` and `Projection`; the test asserts that, so a new field is
 * a red build until it has been classified.
 */

import type { CheckState, DraftedReview, Projection, RunRecord } from "../../review/types";

/** Every key the two source types have between them. */
export type SourceField = keyof RunRecord | keyof Projection;

/** Read by the serializers below. */
export const PUBLIC_SOURCE_FIELDS: readonly SourceField[] = [
  "id",
  "repo",
  "prNumber",
  "headSha",
  "status",
  "createdAt",
  "updatedAt",
  // What the pull request says about itself (decision 54). Published because
  // every row this plane serves is one where `is_public` is true, so the title
  // and the author are already world-readable on GitHub — a different fact
  // from `approver` below, which names a Cujo operator and appears nowhere
  // else.
  "prTitle",
  "prAuthorLogin",
  "prAuthorId",
  "checks",
  "findings",
  "hardRuleHits",
  "review",
  "gatedReview",
  "error",
  "summary",
];

/**
 * Deliberately not read. `approver` and `decidedAt` name a person; `sessionId`
 * and `turnIds` are harness handles and `deliveryId` is GitHub's; `approval`, `decision`, `externalResume`
 * and `gatedResponseSeen` are the state of a gate no anonymous visitor can
 * touch; `isPublic` is the filter itself and says nothing to a caller who only
 * ever sees rows where it is true.
 */
export const WITHHELD_SOURCE_FIELDS: readonly SourceField[] = [
  "sessionId",
  "turnIds",
  "deliveryId",
  "approver",
  "decidedAt",
  "isPublic",
  "approval",
  "decision",
  "externalResume",
  "gatedResponseSeen",
];

/** Exactly the keys `serializePublicRun` emits. */
export const PUBLIC_RUN_FIELDS = [
  "id",
  "repo",
  "pr_number",
  "head_sha",
  "status",
  "created_at",
  "updated_at",
  "pr_title",
  "pr_author_login",
  "pr_author_id",
  "checks",
  "findings",
  "hard_rule_hits",
  "review",
  "gated_review",
  "error",
  "summary",
] as const;

/** Exactly the keys `serializePublicSummary` emits. */
export const PUBLIC_SUMMARY_FIELDS = [
  "id",
  "repo",
  "pr_number",
  "head_sha",
  "status",
  "created_at",
  "updated_at",
  // The title alone. A list row names the pull request; the author belongs to
  // the page that is about one run, not to a column repeated down a table.
  "pr_title",
] as const;

/**
 * The drafted review, shaped rather than passed through. `toolCallId` is a
 * harness handle and `findings` is the agent's own unvalidated tool-call
 * payload, already merged into the run's `findings` by then; neither is
 * rendered, so neither is published.
 */
function publicReview(review: DraftedReview | null) {
  if (!review) return null;
  return { tool: review.tool, body: review.body, comments: review.comments };
}

/**
 * A check, without its `threadId`. The report is the point of the public board
 * and stays; the thread id is a TrueForge handle, and the rule this module
 * keeps is that no harness handle is published — the same rule that shapes
 * `toolCallId` out of the review. Withholding one and publishing the other was
 * an inconsistency, not a decision.
 *
 * It cost the UI its React key, which now comes from the position in a list
 * whose order is fixed by the fold.
 */
function publicCheck(check: CheckState) {
  return {
    title: check.title,
    isCheck: check.isCheck,
    status: check.status,
    report: check.report,
    error: check.error,
    startedAt: check.startedAt,
    endedAt: check.endedAt,
  };
}

/** One run in full, for the public detail page. */
export function serializePublicRun(view: { run: RunRecord; projection: Projection }) {
  const { run, projection } = view;
  return {
    id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    pr_title: run.prTitle,
    pr_author_login: run.prAuthorLogin,
    pr_author_id: run.prAuthorId,
    checks: projection.checks.map(publicCheck),
    findings: projection.findings,
    hard_rule_hits: projection.hardRuleHits,
    review: publicReview(projection.review),
    // The accusation, published only once it is on the pull request. Before
    // that this board would be publishing the exact thing the gate exists to
    // hold back, to an audience with no way to have allowed it. Keyed on
    // `status`, which is already public, rather than on `gatedResponseSeen`,
    // which this module deliberately does not read.
    gated_review: run.status === "blocked_posted" ? publicReview(projection.gatedReview) : null,
    error: projection.error,
    summary: projection.summary,
  };
}

/** One row of the public list. */
export function serializePublicSummary(run: RunRecord) {
  return {
    id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    pr_title: run.prTitle,
  };
}
