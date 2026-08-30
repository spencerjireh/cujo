/**
 * The run projection (docs/spec.md Contract 6). Everything here is derived from
 * TrueForge events; TrueForge stays the source of truth (decision 18).
 */

import type { CheckTimings, SetupTimings } from "./timings";

export type { CheckTimings, SetupTimings };

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

/**
 * What a stretch of a run cost, in tokens.
 *
 * Two producers fill this in and they are not interchangeable. The run's total
 * comes from `TurnStateDone.metrics`, which TrueForge computes for the whole
 * turn and is the only place `reasoningTokens` and `costUsd` exist. A check's
 * share comes from summing the `usage` on its own thread's `model.message`
 * events, which is the only way to attribute anything per check.
 *
 * `messages` is the count that went into the sum, so a reader can tell a check
 * that cost nothing from one nothing was counted for.
 */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Turn metrics only; a per-message `usage` does not break these out. */
  reasoningTokens?: number;
  /** TrueForge's own estimate. Cujo keeps no price table (decision 53's spirit). */
  costUsd?: number;
  messages: number;
}

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
  /**
   * Why the sub-agent's final message ended, as the provider reported it —
   * `stop`, `length`, `tool_calls`, `content_filter`. Without it a report cut
   * off at the model's output limit is indistinguishable from one that was
   * never written: both parse to `null` and both land as `check_missing`, and
   * only one of them is a cap somebody should raise.
   *
   * Optional, and it must stay optional: `apps/web` mirrors this type by hand
   * and assigns its copy into this one, so a new required field here breaks a
   * build in another app. Absent on a projection stored before it existed.
   */
  finishReason?: string | null;
  /**
   * Whether the model returned a refusal instead of a report. A boolean and not
   * the text: the finding it produces is published, and a refusal can quote the
   * pull request it was reading — which would put model-chosen prose on a public
   * page by a route that never passed the sandbox's escaping.
   */
  refused?: boolean;
  /** This check's own tokens, summed over its thread's model messages. */
  usage?: UsageTotals;
  /**
   * Where this check's time went. Stored rather than computed at serialize
   * time, because `http/public/` has an import allowlist its own test enforces
   * and the serializer is better off copying a field than reaching for a helper.
   */
  timings?: CheckTimings;
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
  | "sensor_unarmed"
  // The report is not the shape it claims to be. Third in this family of three
  // — with `check_missing` and `sensor_unarmed` — and the same `warn` for the
  // same reason: it says something about the evidence, never about the code.
  //
  // It is purely additive. The rules still read the report it describes, field
  // by field and leniently, so a report that fails validation for one reason
  // still trips every tripwire the rest of it sets off. Anything else would let
  // a misplaced roll-up turn a `decoy_read` into silence.
  | "report_invalid";

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
  /**
   * What the whole run cost, summed over every `turn.done` on it — a run holds
   * more than one turn whenever an approval was answered or a turn was retried.
   *
   * Taken from `TurnStateDone.metrics` rather than added up from the messages,
   * because TrueForge computes it and is the only side that knows the reasoning
   * tokens and the cost. Every field of `TurnMetrics` is optional there, so
   * anything absent contributes nothing rather than a zero.
   *
   * It arrives late and in a jump, which is expected and should not be
   * "fixed": the streamed `model.message` is a stub, and usage lands with the
   * persisted copy that `Runner.hydrate` fetches at the terminal event. So this
   * reads zero for most of a run and then fills in at the end.
   */
  usage: UsageTotals;
  /**
   * Where the run went before the first check existed (see `SetupTimings`).
   *
   * Required here and defaulted by `emptyProjection`, like `usage` — but read
   * defensively everywhere, because `getProjection` parses a stored blob
   * straight into this type and a projection written before this field existed
   * rehydrates without it, whatever the compiler believes.
   */
  setup: SetupTimings;
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
  /**
   * The model name and a SHA-256 of the instructions — `agent/SKILL.md` after
   * the tarball URL is substituted in, so it is the string a session would
   * actually be given — held by the process that claimed this run.
   *
   * **Read what that says carefully.** `buildAgentSpec` runs once at boot, and
   * a session is created once per pull request and then kept (decision 16). A
   * run claimed on a session three deploys old is stamped with *today's* model
   * and rubric, not the ones that session is pinned to. These describe the
   * configuration of the process that claimed the run, and describe the session
   * only when that process also created it.
   *
   * Both null for a run claimed before the columns existed. They name no person
   * and authorize nothing, so both are published (decision 34's test).
   */
  model: string | null;
  rubricSha256: string | null;
  prTitle: string | null;
  prAuthorLogin: string | null;
  prAuthorId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A run's checks and findings reduced to what a list row can hold
 * (decision 65).
 *
 * `Projection` carries every sensor report in full, which is the right shape
 * for one run and the wrong one for a hundred: the public list would have to
 * parse a sensor report per row to answer "how long did tests take". This is
 * that answer, derived once by `deriveDigest` and stored beside the projection
 * it came from. It holds no fact the run's own detail route does not already
 * publish.
 */
export interface RunDigest {
  /**
   * Keyed by `CHECK_NAMES`. A missing key means the check never appeared,
   * which is not the same fact as a check that failed — `check_missing` is a
   * hard rule precisely because those two differ.
   */
  checks: Partial<Record<CheckName, DigestCheck>>;
  /** How many findings of each severity, at the time of the fold. */
  findings: Record<Severity, number>;
  /**
   * Wall clock across the checks: the last `endedAt` minus the first
   * `startedAt`. Null while a check is still running, and on a run recorded
   * before those stamps existed. Deliberately not `updatedAt - createdAt`,
   * which on a `blocked_pending` run counts the hours it waited on a person.
   */
  durationMs: number | null;
}

export interface DigestCheck {
  status: CheckState["status"];
  /** How long the check ran, or null while it runs and on an unstamped run. */
  ms: number | null;
  /**
   * How much of that was the sandbox executing the pull request, from
   * `CheckTimings.sandboxMs`. The rest is the sub-agent deciding what to do
   * next, which is the difference between a slow suite and a slow reviewer.
   *
   * Null is three different facts and the shape cannot tell them apart, which
   * is why it is null rather than zero: the check is still running, or its
   * report carried no `runs[]` to measure, or the digest was stored before this
   * field existed and nothing re-derives a digest that is merely stale
   * (`RunStore.backfillDigest` fires only on a missing row). A zero would claim
   * the sandbox did nothing, and on a check that ran a test suite that is the
   * one reading it certainly was not.
   *
   * Required rather than optional on purpose. `apps/web` mirrors this type by
   * hand and assigns its copy into this one, so a required field is a red build
   * there until the mirror gains it; an optional one compiles green with the
   * board silently reading `undefined`.
   */
  sandboxMs: number | null;
}
