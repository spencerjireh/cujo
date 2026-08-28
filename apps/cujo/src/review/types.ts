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
  /**
   * Event timestamps, taken from the thread's own `createdAt` rather than the
   * clock, so the fold stays pure and a rehydrated run keeps the timing it had.
   * The UI puts the four checks on one time axis with these.
   */
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReviewComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export type Severity = "info" | "warn" | "critical";

/** One finding (Contract 3). `source` says which layer produced it. */
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

export interface DraftedReview {
  tool: "post_advisory_review" | "post_blocking_review";
  toolCallId: string;
  body: string;
  comments: ReviewComment[];
  /** The agent's own findings, as passed on the review tool call. */
  findings: unknown[];
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
  /** Hard-rule hits re-derived from the check reports (decision 21). */
  hardRuleHits: Finding[];
  /** Hard-rule hits merged with the agent's findings, critical first. */
  findings: Finding[];
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
  /**
   * Was the repo public when this run was claimed (decision 34). The stored
   * column is nullable, and the unanswered case collapses to `false` here so
   * no consumer has to carry a third state; the read paths that matter filter
   * in SQL anyway.
   */
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}
