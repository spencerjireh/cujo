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
  "blocked_unattended",
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
  /**
   * The TrueForge thread. Operator plane only: it is a harness handle, and the
   * public serializer publishes none of those (decision 34).
   */
  threadId?: string;
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

/**
 * `toolCallId` and `findings` are operator-only: the public serializer shapes
 * them out, since one is a harness handle and the other is the agent's own
 * unvalidated tool-call payload (decision 34).
 */
export const REVIEW_TOOLS = [
  "post_advisory_review",
  "post_blocking_review",
  "post_gated_review",
] as const;
export type ReviewTool = (typeof REVIEW_TOOLS)[number];

export interface DraftedReview {
  tool: ReviewTool;
  toolCallId?: string;
  body: string;
  comments: ReviewComment[];
  findings?: unknown[];
}

/**
 * `GET /runs` — deliberately narrower than the detail shape.
 *
 * There is one plane since decision 57, so every field here is one the board
 * actually emits. `approver` and `decided_at` are gone entirely rather than
 * optional: `apps/cujo` withholds them by construction, so a type that still
 * mentioned them would describe a payload nothing produces.
 */
export interface RunSummary {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
}

export interface RunList {
  runs: RunSummary[];
}

/** `GET /runs/:id` and every `run` event on the SSE stream. */
export interface Run extends RunSummary {
  /**
   * Handles into TrueForge and the webhook delivery, published since decision
   * 52. Optional because a `run` event on the stream and a run stored by an
   * older release may predate them, not because a plane withholds them.
   */
  session_id?: string;
  turn_ids?: string[];
  external_resume?: boolean;
  delivery_id?: string | null;
  checks: CheckState[];
  findings: Finding[];
  hard_rule_hits: Finding[];
  review: DraftedReview | null;
  /**
   * The accusation held for a human, published only once it posted — before
   * that, publishing it is exactly what the gate prevents. Absent entirely on
   * a run that predates the gated tool.
   */
  gated_review?: DraftedReview | null;
  error: string | null;
  summary: string | null;
}

/**
 * Whether `review` is already on the pull request.
 *
 * `review` only ever holds an **ungated** call, and both ungated tools post the
 * moment the model calls them (decision 6). So `blocked_pending` says nothing
 * about this slot: that run is waiting on the *accusation* in `gated_review`
 * while its observation is already public, and `isLive` — which covers both
 * live states — labelled that posted observation "Drafted review".
 *
 * `running` stays conservative, and it is the only state that needs to be: the
 * fold records the call from the model message, which can arrive a moment
 * before the POST it describes comes back.
 */
export function reviewPosted(run: Run): boolean {
  return !!run.review && run.status !== "running";
}

/** Whether the accusation was confirmed and posted, rather than still waiting. */
export function gatedReviewPosted(run: Run): boolean {
  return !!run.gated_review && run.status === "blocked_posted";
}
