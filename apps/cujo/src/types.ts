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

/**
 * One repo bound to one Discord channel (Contract 7). Operator data rather
 * than run state, which is why it lives in the store and not the environment
 * (decision 24).
 */
export interface DiscordChannelRecord {
  /** `owner/name`, lower-cased: GitHub repo names are case-insensitive. */
  repo: string;
  channelId: string;
  guildId: string | null;
  channelName: string | null;
  /** Mentioned by the ping a blocked run posts. Null means ping with no mention. */
  notifyRoleId: string | null;
  /**
   * Who bound it: an operator's Access email, or `discord:<user id>` when it
   * came from a slash command (Contract 8). Null for a binding written before
   * the column existed.
   */
  boundBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One Discord server allowed to manage notifications for one repo (Contract 8,
 * decision 27). Written only over the Access-gated API, so the question "which
 * repos may this server see" always has a verified email attached to it; the
 * server then chooses its own channel and role.
 */
export interface GuildRepoAuthorization {
  guildId: string;
  /** `owner/name`, lower-cased, as everywhere else. */
  repo: string;
  guildName: string | null;
  /** The Access email of the operator who authorized the pair. */
  authorizedBy: string;
  authorizedAt: string;
}

/** The card Cujo posted for one run, plus the one-shot ping beside it. */
export interface RunDiscordMessage {
  runId: string;
  /**
   * Captured when the card is created. Every later edit uses this rather than
   * the current mapping, so re-pointing a repo mid-run cannot edit a message
   * into a channel that does not hold it.
   */
  channelId: string;
  messageId: string | null;
  pingMessageId: string | null;
  /**
   * True once the ping has been rewritten to say the run can no longer be
   * decided. Held separately from the status, because the card is written
   * first: without it, a failed ping edit would leave an actionable "needs a
   * human" alert in the channel that nothing ever retries.
   */
  pingResolved: boolean;
  /** The status the card was last written for; the dedupe key (Contract 7). */
  lastNotifiedStatus: RunStatus | null;
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
