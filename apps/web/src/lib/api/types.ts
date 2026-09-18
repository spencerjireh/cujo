/**
 * The wire shapes served by `apps/cujo`. These are hand-written rather than
 * imported from `@cujo/cujo` for two reasons: that package pulls `node:sqlite`
 * and the harness contract into the module graph, and its internal `RunRecord` is
 * not the wire shape — `api.ts` serializes run fields as snake_case while
 * leaving the nested objects camelCase. `types.test.ts` guards the drift.
 */

export const RUN_STATUSES = [
  "running",
  "clean",
  "blocked",
  "dismissed",
  "error",
  "unproven",
  "superseded",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CHECK_NAMES = ["tests", "probes", "smoke", "detonation"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const SEVERITIES = ["critical", "warn", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A run is live while the turn can still change it. */
export function isLive(status: RunStatus): boolean {
  return status === "running";
}

/**
 * What a turn cost, as the harness counted it.
 *
 * Optional keys are the ones the harness does not always report:
 * `reasoningTokens` arrives only on turn metrics, and `costUsd` only when the
 * provider priced the call. Absent is "not reported", never zero — a run that
 * carries no record of what it cost did not cost nothing (decision 54).
 */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
  costUsd?: number;
  messages: number;
}

/**
 * Where a run's tokens went, thread by thread (decision 141): one row per
 * thread summed from that thread's own messages, and the largest tool results
 * by byte size. A thread is named by its title — `main` for the parent — and
 * never by a harness id. `reasoningTokens` is null when no message on the
 * thread reported one.
 */
export interface LedgerThread {
  title: string;
  attempt: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  toolResultBytes: number;
}

interface LedgerToolResult {
  thread: string;
  tool: string;
  bytes: number;
  isError: boolean;
}

export interface RunLedger {
  threads: LedgerThread[];
  largestToolResults: LedgerToolResult[];
}

/**
 * Where one check's wall time went.
 *
 * `sandboxMs` is what `sniff.py` reported for its own runs inside the sandbox,
 * so `modelMs` is the remainder — the part where the model was deciding rather
 * than where the pull request's code was executing. `apps/cujo` omits `modelMs`
 * when that subtraction comes out negative rather than publishing a number it
 * cannot stand behind, so every key here is optional on purpose.
 */
export interface CheckTimings {
  wallMs?: number;
  sandboxMs?: number;
  modelMs?: number;
}

/**
 * Where the run went before the first check existed (decision 67).
 *
 * Four event stamps and a count of the parent's own messages, measuring the
 * window decision 67 was written to expose: a run does seconds of execution
 * inside minutes of wall clock, and this is the largest part of the remainder.
 *
 * Every stamp is nullable, and two of them are absent for reasons rather than
 * by accident. `sandboxCreatedAt` is session-scoped, so a second run on the
 * same pull request never sees one — the sandbox was already there, which is
 * why a re-run is faster and why a zero would say the opposite. `ms` is
 * `agentStartedAt` to `firstCheckAt`, and `apps/cujo` omits it unless both
 * stamps are usable rather than publishing a subtraction it cannot stand
 * behind, the same restraint `CheckTimings.modelMs` above is kept under.
 */
export interface SetupTimings {
  turnCreatedAt: string | null;
  /**
   * Null on every run from decision 113 onward. It came from the harness's
   * `sandbox.created` event, and the harness stopped provisioning sandboxes;
   * `sandboxProvisionedMs` is where the number lives now. Kept because a run
   * stored before that change still carries the stamp.
   */
  sandboxCreatedAt: string | null;
  /** How long the sandbox took to provision, off `sandbox_create` (115). */
  sandboxProvisionedMs?: number;
  agentStartedAt: string | null;
  firstCheckAt: string | null;
  messages: number;
  ms?: number;
}

export interface CheckState {
  /**
   * The harness thread. Operator plane only: it is a harness handle, and the
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
  /**
   * Which attempt at this check's name this thread was, 1 unless the rubric
   * respawned a failed sub-agent (decision 108). `publicCheck` emits 1 rather
   * than null for a run that predates the field, so there is no absent case to
   * render — it is optional here only because this interface is assigned into
   * `apps/cujo`'s.
   */
  attempts?: number;
  /**
   * Optional *and* nullable, which are two different facts and both real here.
   * `publicCheck` always emits these keys as null when it has nothing, so null
   * is "this check reported none"; absent is a `run` frame from an older
   * release, which predates the fields entirely.
   */
  usage?: UsageTotals | null;
  timings?: CheckTimings | null;
}

export interface Finding {
  source: "hard_rule" | "agent" | "build_fact";
  check: string;
  severity: Severity;
  title: string;
  evidence: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

interface ReviewComment {
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
const REVIEW_TOOLS = ["post_advisory_review", "post_blocking_review"] as const;
export type ReviewTool = (typeof REVIEW_TOOLS)[number];

export interface DraftedReview {
  tool: ReviewTool;
  toolCallId?: string;
  /** What the model sent. Since decision 74 that is one sentence. */
  body: string;
  /** What `github-mcp` posted, reproduced by the shared renderer. */
  composed_body?: string;
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
/**
 * The two reviews (decision 133). `sandbox` runs the pull request; `diff`
 * reads it against the repository's standards and never provisions a box.
 */
export type ReviewMode = "sandbox" | "diff";

export interface RunSummary {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  /**
   * Which review this was (decision 135). On both planes because a list of
   * `clean` rows cannot otherwise tell a run that read the diff from one that
   * ran it, and those are different claims. Optional only for a `run` frame
   * from a release that predates it; a row from the API always carries it.
   */
  mode?: ReviewMode;
  /**
   * What the pull request calls itself. Both planes send it on every row, so
   * it is required here and nullable rather than optional: null is a run
   * recorded before titles were stored, or one whose PR read never completed,
   * and every render falls back to `repo #N` (decision 55).
   */
  pr_title: string | null;
  /**
   * What the four checks measured, reduced (decision 65). Null on a run
   * claimed but never folded, and absent on a `run` frame from the SSE stream,
   * which carries the detail shape instead — so a reader has to handle both,
   * and `RunSummary` is the only place the reduction appears.
   *
   * Nested keys are camelCase, like every other nested object on this wire.
   */
  digest?: RunDigest | null;
}

export interface RunDigest {
  /**
   * A key that is missing is a check that never appeared, which the board must
   * draw differently from one that ran and passed — `check_missing` is a hard
   * rule precisely because those two differ.
   */
  checks: Partial<Record<CheckName, DigestCheck>>;
  findings: Record<Severity, number>;
  /**
   * The envelope around the checks, not `updated_at − created_at`: the latter
   * counted the hours a held run once waited on a person. Null while a check
   * is still running, and on a run recorded before the stamps existed.
   */
  durationMs: number | null;
}

export interface DigestCheck {
  status: CheckState["status"];
  /** How long the check ran, or null while it runs and on an unstamped run. */
  ms: number | null;
  /**
   * How much of that was the sandbox executing the pull request; the rest was
   * the sub-agent deciding what to do next. The specimen draws the split as the
   * solid part of an arm, which is the same reading `ChecksTimeline` gives a
   * lane on the run page.
   *
   * Null three ways and the shape cannot tell them apart, so nothing may treat
   * it as zero: the check is still running, its report carried nothing to
   * measure, or the digest was stored before the field existed and is never
   * re-derived. An arm with a null share is drawn undivided.
   */
  sandboxMs: number | null;
}

export interface RunList {
  runs: RunSummary[];
}

/** `GET /runs/:id` and every `run` event on the SSE stream. */
export interface Run extends RunSummary {
  /**
   * Handles into the harness and the webhook delivery, published since decision
   * 52. Optional because a `run` event on the stream and a run stored by an
   * older release may predate them, not because a plane withholds them.
   */
  session_id?: string;
  turn_ids?: string[];
  delivery_id?: string | null;
  checks: CheckState[];
  findings: Finding[];
  hard_rule_hits: Finding[];
  review: DraftedReview | null;
  /**
   * Who opened the pull request, on the run page only — a list row names the
   * pull request, not the person. Both planes send both, so both are required
   * and nullable; they are null together for a run recorded before the author
   * was stored, and for a deleted account. The id is what an avatar URL is
   * built from, never the login.
   */
  pr_author_login: string | null;
  pr_author_id: number | null;
  error: string | null;
  summary: string | null;
  /**
   * What the whole run cost, summed across every turn. Null when the run
   * predates the field, which is not the same claim as zero (decision 54), and
   * optional for the same reason `session_id` is: a `run` frame from an older
   * release carries no key at all.
   */
  usage?: UsageTotals | null;
  /**
   * What reviewed this pull request, and against which rubric. The hash is of
   * the substituted `agent/SKILL.md`, so the two together are what makes a
   * verdict reproducible rather than merely asserted. Null on a run recorded
   * before either column existed.
   */
  model?: string | null;
  rubric_sha256?: string | null;
  /**
   * What the turn was allowed to spend, in billed tokens (decision 132), read
   * beside `usage`. Null on a sandbox run, which carries no budget, and on a
   * run from before the column; optional for the reason `usage` is.
   */
  budget_tokens?: number | null;
  /**
   * The setup window (decision 67). Optional and nullable for the two different
   * reasons `usage` above carries: absent is a `run` frame from a release that
   * predates the field, null is a run the fold recorded before it existed.
   * Neither is an empty window, which is why the timeline draws no setup lane
   * rather than a lane of length zero.
   */
  setup?: SetupTimings | null;
  /**
   * The token ledger (decision 141). Optional and nullable for the reasons
   * `usage` is: absent is an older frame, null is a run the fold recorded
   * before the field existed.
   */
  ledger?: RunLedger | null;
}

/**
 * Whether `review` is already on the pull request.
 *
 * Both tools post the moment the model calls them (decision 138), so a
 * recorded call is a posted review on every finished run. `running` stays
 * conservative, and it is the only state that needs to be: the fold records
 * the call from the model message, which can arrive a moment before the POST
 * it describes comes back.
 */
export function reviewPosted(run: Run): boolean {
  return !!run.review && run.status !== "running";
}
