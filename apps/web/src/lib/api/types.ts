/**
 * The wire shapes served by `apps/cujo`. These are hand-written rather than
 * imported from `@cujo/cujo` for two reasons: that package pulls `node:sqlite`
 * and the TrueForge SDK into the module graph, and its internal `RunRecord` is
 * not the wire shape — `api.ts` serializes run fields as snake_case while
 * leaving the nested objects camelCase. `types.test.ts` guards the drift.
 */

export const RUN_STATUSES = [
  "running",
  "clean",
  "blocked_pending",
  "blocked_posted",
  "denied",
  "error",
  "superseded",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CHECK_NAMES = ["tests", "probes", "smoke", "detonation"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const SEVERITIES = ["critical", "warn", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A run is live while the turn can still change it. Nothing else may be approved. */
export function isLive(status: RunStatus): boolean {
  return status === "running" || status === "blocked_pending";
}

export interface CheckState {
  threadId: string;
  title: string;
  isCheck: boolean;
  status: "running" | "done" | "error";
  report: unknown | null;
  error: string | null;
  /** Added by apps/cujo's fold from thread.created / thread.done. */
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface Finding {
  source: "hard_rule" | "agent";
  check: string;
  severity: Severity;
  title: string;
  evidence: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

export interface ReviewComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export interface DraftedReview {
  tool: "post_advisory_review" | "post_blocking_review";
  toolCallId: string;
  body: string;
  comments: ReviewComment[];
  findings: unknown[];
}

export interface PendingApproval {
  threadId: string;
  toolCallId: string;
  sourceEventId: string;
}

/** `GET /runs` — deliberately narrower than the detail shape. */
export interface RunSummary {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  status: RunStatus;
  approver: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunList {
  runs: RunSummary[];
}

/** `GET /runs/:id` and every `run` event on the SSE stream. */
export interface Run extends RunSummary {
  session_id: string;
  turn_ids: string[];
  decided_at: string | null;
  checks: CheckState[];
  findings: Finding[];
  hard_rule_hits: Finding[];
  review: DraftedReview | null;
  /** Non-null only while status is `blocked_pending` (api.ts nulls it otherwise). */
  approval: PendingApproval | null;
  external_resume: boolean;
  error: string | null;
  summary: string | null;
}

export interface ApproveResult {
  ok: true;
  decision: "allow" | "deny";
  approver: string;
}

/**
 * A decision is offerable only when the run is paused on an approval that the
 * fold actually recorded. `superseded`, `error`, and the Contract 6 tripwire
 * (an approval raised on a thread other than `main`, which nulls `approval`)
 * all fall out of this one predicate.
 */
export function canDecide(run: Run): boolean {
  return run.status === "blocked_pending" && run.approval !== null;
}

/**
 * Whether the review is already on the pull request.
 *
 * An advisory review is ungated and posts during the turn (decision 6), so it
 * is live on GitHub as soon as the run stops running — calling it a draft on a
 * `clean` run is wrong. A blocking review is held for a human and only reaches
 * GitHub once the run is `blocked_posted`.
 */
export function reviewPosted(run: Run): boolean {
  if (!run.review) return false;
  if (run.review.tool === "post_advisory_review") return !isLive(run.status);
  return run.status === "blocked_posted";
}
