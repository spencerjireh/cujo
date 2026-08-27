/**
 * The run projection (docs/spec.md Contract 6). Everything here is derived from
 * TrueForge events; TrueForge stays the source of truth (decision 18).
 */

export type RunStatus =
  | "running"
  | "clean"
  | "blocked_pending"
  | "blocked_posted"
  | "denied"
  | "error"
  /** A newer head on the same PR replaced this run before it finished. */
  | "superseded";

export const CHECK_NAMES = ["tests", "probes", "smoke", "detonation"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export interface CheckState {
  threadId: string;
  title: string;
  /** True when the title is one of the four check names. */
  isCheck: boolean;
  status: "running" | "done" | "error";
  report: unknown | null;
  error: string | null;
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
}

export interface PendingApproval {
  threadId: string;
  toolCallId: string;
  sourceEventId: string;
}

export interface Projection {
  status: RunStatus;
  turnIds: string[];
  checks: CheckState[];
  review: DraftedReview | null;
  approval: PendingApproval | null;
  /** Decision carried by a resume turn, whoever sent it. */
  decision: "allow" | "deny" | null;
  /** Set by the folder when a resume turn was not sent by Cujo. */
  externalResume: boolean;
  gatedResponseSeen: boolean;
  error: string | null;
  /** Final text of the parent thread, when the turn produced one. */
  summary: string | null;
}

export interface RunRecord {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  sessionId: string;
  turnIds: string[];
  status: RunStatus;
  approver: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
