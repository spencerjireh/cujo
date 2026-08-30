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
 *
 * `RunDigest` is classified the same way but on its own list. It is derived
 * from `checks` and `findings`, both already public above, so folding its keys
 * into `SourceField` would collide on those two names and make the no-duplicate
 * assertion unstatable — a third list keeps every key of every source type
 * written down, which is the property that matters.
 *
 * `DigestCheck` gets a fourth list, and it is here because the third was not
 * enough. `PUBLIC_DIGEST_FIELDS` classifies `RunDigest`'s three keys, one of
 * which is `checks` — and this file used to copy that object through by
 * reference, so every field of a check reached the wire without appearing on
 * any list. The guard was blind exactly one level below where it was written.
 */

import { CHECK_NAMES, type CheckName } from "../../review/types";
import type {
  CheckState,
  DigestCheck,
  DraftedReview,
  Projection,
  RunDigest,
  RunRecord,
} from "../../review/types";

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
  // What the pull request says about itself (decision 55). Published because
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
  // Handles into TrueForge and GitHub, published deliberately (decision 57).
  // They authorize nothing: the console they name keeps its own Access
  // application, which is the thing standing between a reader and a session.
  "sessionId",
  "turnIds",
  "externalResume",
  "deliveryId",
  // What produced the verdict (decision 34's test, applied): a model name and
  // a hex digest of a rubric that is itself in a public repository. Neither
  // names a person and neither authorizes anything, which is the same argument
  // `sessionId` above is published on.
  "model",
  "rubricSha256",
  // What the run cost and where its time went. The per-check half rides inside
  // `checks`, so only the run total is named here.
  "usage",
  // Where the run went before the first check existed. Four event timestamps
  // and a count of the parent's own messages: it names no person, and every
  // stamp in it is a time at which this public run did something.
  "setup",
];

/**
 * Deliberately not read. `approver` and `decidedAt` name a person, which is
 * the one rule this board has always kept: the confirming `/cujo confirm`
 * comment is on the pull request for anyone to read, and Cujo does not become
 * the publisher of somebody's GitHub login on top of that.
 *
 * `approval` and `decision` are the state of a gate no anonymous visitor can
 * touch, and `gatedResponseSeen` is how the fold knows the gate was answered.
 * `isPublic` is the filter itself and says nothing to a caller who only ever
 * sees rows where it is true.
 */
export const WITHHELD_SOURCE_FIELDS: readonly SourceField[] = [
  "approver",
  "decidedAt",
  "isPublic",
  "approval",
  "decision",
  "gatedResponseSeen",
];

/**
 * Exactly the keys `serializePublicRun` emits — every one of them, on every
 * response.
 *
 * A field with nothing to report is `null` and never absent. That is not style:
 * `JSON.stringify` drops an `undefined`, so a value read straight off a stored
 * projection that predates its field takes the key out of the payload with it,
 * and this list stops being a promise precisely where a client is least able to
 * see it coming. Every optional source field is therefore read with `?? null`.
 */
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
  "session_id",
  "turn_ids",
  "external_resume",
  "delivery_id",
  "model",
  "rubric_sha256",
  "usage",
  "setup",
] as const;

/**
 * Every key of `RunDigest`, all published (decision 65). Each is a reduction
 * of `checks` or `findings`, which the detail route already serves in full to
 * the same anonymous caller — this makes them cheap, not visible.
 */
export const PUBLIC_DIGEST_FIELDS: readonly (keyof RunDigest)[] = [
  "checks",
  "findings",
  "durationMs",
];

/**
 * Every key of one check inside `digest.checks`, all published.
 *
 * Its own list because the one above cannot reach here. `PUBLIC_DIGEST_FIELDS`
 * classifies `RunDigest`'s three top-level keys, and `checks` is one of them —
 * so a field added to `DigestCheck` was published by a list that never named
 * it, past a test that could not see it, contradicting the promise this file
 * makes twice. `sandboxMs` is the field that found the hole.
 *
 * Each of these is still a reduction of what the detail route already serves in
 * full to the same anonymous caller: `status` and `ms` restate the check's own
 * stamps, and `sandboxMs` is `timings.sandboxMs` off the same check.
 */
export const PUBLIC_DIGEST_CHECK_FIELDS: readonly (keyof DigestCheck)[] = [
  "status",
  "ms",
  "sandboxMs",
];

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
  // What the checks reported, reduced (decision 65). A row carrying only a
  // status says a run was blocked; this says which check said so and how long
  // it watched, which is the difference between a verdict and evidence. Its
  // own keys are guarded by `PUBLIC_DIGEST_FIELDS`.
  "digest",
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
    // Both null rather than absent when the check never produced them, so the
    // key is always there for a reader and a client needs no third case.
    usage: check.usage ?? null,
    timings: check.timings ?? null,
  };
}

/**
 * One check of a digest, shaped rather than passed through — which is the whole
 * point, because passing `digest.checks` through by reference is what let a new
 * field reach the wire unclassified.
 *
 * `?? null` for the reason `usage` and `setup` have it below: a digest stored
 * before `sandboxMs` existed parses without the key, `JSON.stringify` drops an
 * `undefined`, and the key this module promises to emit would disappear exactly
 * where a client is least able to see it coming. Nothing re-derives a digest
 * that is merely stale — `backfillDigest` fires only on a missing row — so
 * those rows are permanent and this is the only thing standing between them and
 * a payload that silently changes shape per run.
 */
function publicDigestCheck(check: DigestCheck) {
  return { status: check.status, ms: check.ms, sandboxMs: check.sandboxMs ?? null };
}

/**
 * The checks of a digest, keyed by check name.
 *
 * Walked over `CHECK_NAMES` rather than `Object.entries`, so the key order is
 * the fold's and a key that is not a check name cannot reach the wire at all. A
 * check the run never had stays absent, which is the fact `RunDigest.checks`
 * documents: a missing key is not a check that reported nothing.
 */
function publicDigestChecks(checks: RunDigest["checks"]) {
  const out: Partial<Record<CheckName, ReturnType<typeof publicDigestCheck>>> = {};
  for (const name of CHECK_NAMES) {
    const check = checks[name];
    if (check) out[name] = publicDigestCheck(check);
  }
  return out;
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
    // `turnIds` is a key of both `RunRecord` and `Projection`. The run's is the
    // durable one — the projection's is rebuilt by the fold — so that is the
    // one published, and the projection's stays unread.
    session_id: run.sessionId,
    turn_ids: run.turnIds,
    external_resume: projection.externalResume,
    delivery_id: run.deliveryId,
    model: run.model,
    rubric_sha256: run.rubricSha256,
    // `?? null` for the same reason `publicCheck` has it, and it is not
    // decoration: a projection stored before this field existed deserializes
    // without it, `JSON.stringify` drops an `undefined`, and the key this
    // module promises to emit disappears from the payload. Null rather than
    // zeros, because a run from before the field did not cost nothing — it has
    // no record, which is a different claim (decision 54).
    usage: projection.usage ?? null,
    // Same `?? null`, same reason. Copied off the projection rather than
    // derived here: `settleSetup` lives in `review/timings`, and this module
    // may not import it (the import allowlist in serialize.test.ts).
    setup: projection.setup ?? null,
  };
}

/**
 * One row of the public list.
 *
 * The digest's absence is a fact rather than a zero: a run claimed but never
 * folded has no checks, which is not the same as four checks that reported
 * nothing. It is null in that case rather than an empty digest, so a reader
 * cannot mistake one for the other.
 */
export function serializePublicSummary(row: { run: RunRecord; digest: RunDigest | null }) {
  const { run, digest } = row;
  return {
    id: run.id,
    repo: run.repo,
    pr_number: run.prNumber,
    head_sha: run.headSha,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    pr_title: run.prTitle,
    // One nested field and not three loose ones. `checks` at the top level
    // would collide with the detail route's `checks`, which is the same word
    // for a different shape — the array of what each check said, against this
    // reduction of how each one ended. Nested keys stay camelCase, the way
    // `publicCheck` leaves `isCheck` and `startedAt`.
    //
    // Shaped rather than passed through, for the reason the rest of this file
    // is: a field added to `RunDigest` has to be written into
    // `PUBLIC_DIGEST_FIELDS` and then into this literal before it can reach
    // the wire. `checks` goes through `publicDigestChecks` for the same reason
    // one level down — it used to be copied by reference, so that promise held
    // of `RunDigest` and not of `DigestCheck`.
    digest: digest
      ? {
          checks: publicDigestChecks(digest.checks),
          findings: digest.findings,
          durationMs: digest.durationMs,
        }
      : null,
  };
}
