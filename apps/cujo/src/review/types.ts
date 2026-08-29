/**
 * The run projection (docs/spec.md Contract 6). Everything here is derived from
 * TrueForge events; TrueForge stays the source of truth (decision 18).
 */

export type RunStatus =
  | "running"
  | "clean"
  | "blocked_pending"
  /**
   * A blocking review Cujo posted on its own authority: a correctness
   * critical, which no human was asked about. Distinct from `blocked_posted`,
   * where somebody confirmed an accusation — telling those two apart is what
   * the gate exists for, and `approver` alone cannot, because it is also null
   * on a run nobody ever looked at.
   */
  | "blocked_unattended"
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

/**
 * Which Layer 1 rule produced a hard-rule finding. Present so the trusted side
 * can tell a correctness claim from a malice claim without matching on prose:
 * `tests_failed` says the pull request broke something, and the other four
 * accuse code of acting against the person running it. Optional because a
 * projection stored before this field existed rehydrates without it, and
 * because an agent finding has no rule at all.
 */
export type HardRule =
  | "tests_failed"
  | "decoy_read"
  | "decoy_in_egress"
  | "wrote_sensitive"
  | "egress_to_unknown_host"
  | "check_missing"
  // Not an accusation and not a defect: a sensor that was not watching, so the
  // clean report it produced is worth less than it looks. `warn`, like
  // `check_missing`, and for the same reason — it says the evidence is thin,
  // not that the code did anything.
  | "sensor_unarmed";

/** One finding (Contract 3). `source` says which layer produced it. */
export interface Finding {
  source: "hard_rule" | "agent";
  check: string;
  severity: Severity;
  title: string;
  evidence: string;
  rule?: HardRule;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

/** The three review tools (Contract 4). Two of them post REQUEST_CHANGES. */
export type ReviewTool = "post_advisory_review" | "post_blocking_review" | "post_gated_review";

export interface DraftedReview {
  tool: ReviewTool;
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
  /**
   * The review that reached the pull request. Only ever an ungated call, so a
   * recorded call is a posted review: `post_advisory_review` and
   * `post_blocking_review` post the moment the model calls them.
   */
  review: DraftedReview | null;
  /**
   * A `post_gated_review` call: drafted, and not on the pull request until
   * `gatedResponseSeen`. Its own slot because the run can hold both at once —
   * on the malice path the observation posts as an advisory and the conclusion
   * waits — and one field cannot hold both without the second destroying the
   * record of the first.
   */
  gatedReview: DraftedReview | null;
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
  /**
   * The `X-GitHub-Delivery` of the webhook that claimed this run, or null for
   * a run claimed before the column existed. Every log line for the run
   * carries it as `ray`, which is what survives the request ending while the
   * run does not (decision 37). Published on the board since decision 57: it
   * is the id a reader needs to correlate what they are looking at with a log
   * line, and it authorizes nothing on its own.
   */
  deliveryId: string | null;
  /**
   * What the pull request says about itself: its title, and who opened it
   * (decision 55). Read from GitHub once when the run is claimed and joined
   * onto every run read, so a card and a run page name the same two parties
   * without either asking GitHub again.
   *
   * All three are null for a run recorded before the columns existed, or one
   * whose PR read never completed; `authorLogin` and `authorId` are also both
   * null when the account has since been deleted. Untrusted, like every other
   * string GitHub hands over.
   */
  prTitle: string | null;
  prAuthorLogin: string | null;
  prAuthorId: number | null;
  createdAt: string;
  updatedAt: string;
}
