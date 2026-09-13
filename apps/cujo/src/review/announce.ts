/**
 * What Cujo says on a pull request when the agent did not say it.
 *
 * One plain issue comment, and never a review. It cannot create a review, set
 * `REQUEST_CHANGES`, or approve anything, because the gate sits on one
 * `github-mcp` tool and this module is on the other side of that line — it
 * reaches GitHub through `createComment` and holds no other write. That is the
 * property, and it is structural rather than a rule somebody has to remember.
 *
 * **Against decision 38.** The invariant there, stated honestly, is that
 * *nothing states a finding on a pull request without a human allowing it*, and
 * decision 42 already narrows "a finding" to an accusation: a correctness
 * critical posts unattended as `post_blocking_review`, and only a malice claim
 * waits. So the line this module must not cross is the accusation, and it does
 * not — `heldClaims` counts malice claims and never names one (decisions 109,
 * 110). Everything else it says is weaker than what decision 42 already lets
 * Cujo post on its own authority, and a comment is weaker still than the review
 * it stands in for, because it sets no review state at all.
 *
 * Decision 38 also rejected a status comment edited in place, for cluttering a
 * thread Cujo is about to post a review into. Neither caller here is that. One
 * fires only when no review was posted and none is coming, the other only after
 * the review has already posted, and a run gets at most one comment ever —
 * which `claim` enforces, because a comment is not the idempotent POST a
 * reaction is.
 */

import type { Logger } from "@cujo/log";
import { safeText } from "@cujo/review-render";
import type { GitHubReader } from "../clients/github";
import { isMaliceClaim, isOperationalRule } from "./findings";
import { type UiLinks, runUrl } from "./links";
import { CHECK_NAMES, type CheckName, type CheckState, type Finding } from "./types";
import type { Projection, RunRecord } from "./types";

/**
 * Which comment a run used its one slot on. Stored, so a restart does not post
 * a second copy of the same thing.
 */
type AnnouncementKind = "turn_timeout" | "evidence_gap";

export interface AnnounceDeps {
  github: Pick<GitHubReader, "createComment">;
  log: Logger;
  /**
   * Takes the run's one comment slot, or returns false because something
   * already has it. Called before the GitHub write and never after: a claim
   * that loses must not produce a comment, and a claim that wins must be
   * durable before the comment exists, or a crash between the two posts twice.
   */
  claim: (runId: string, kind: AnnouncementKind) => boolean;
  links: UiLinks;
}

/** The longest a check's status line gets, so a wide report cannot stretch the table. */
const MAX_EVIDENCE_CHARS = 300;

/** A check's row, or null when the rubric never opened a thread for it. */
function latest(checks: readonly CheckState[], name: CheckName): CheckState | null {
  // Last rather than first, for the reason `deriveDigest` takes the last: a
  // second thread with one check's name is a retry (decision 108).
  let found: CheckState | null = null;
  for (const check of checks) if (check.isCheck && check.title === name) found = check;
  return found;
}

function coverage(projection: Projection): { reported: CheckName[]; unfinished: CheckName[] } {
  const reported: CheckName[] = [];
  const unfinished: CheckName[] = [];
  for (const name of CHECK_NAMES) {
    const check = latest(projection.checks, name);
    if (!check) continue;
    if (check.report !== null) reported.push(name);
    else unfinished.push(name);
  }
  return { reported, unfinished };
}

/**
 * How many findings are being withheld because a person has to see them first.
 *
 * A count and never a title. This is the one thing in the whole module that a
 * reader might wish were more specific, and the reason it is not is the gate:
 * an accusation reaches a pull request only once somebody allowed it, and a
 * comment naming one would be that accusation posted by the back door.
 */
function heldClaims(findings: readonly Finding[]): number {
  return findings.filter(isMaliceClaim).length;
}

function evidenceLink(links: UiLinks, run: RunRecord): string {
  const url = runUrl(links, run);
  return url ? `\n\n[What this run measured](${url})` : "";
}

function bullet(finding: Finding): string {
  const evidence = finding.evidence.slice(0, MAX_EVIDENCE_CHARS);
  return `- **${safeText(finding.check)}** — ${safeText(finding.title)}\n  ${safeText(evidence)}`;
}

/**
 * A turn that ran out of time with reports already in hand (decision 109).
 *
 * Says which check hung and what the others measured. It deliberately does not
 * say what the evidence means: the agent is the thing that reads reports, it
 * never got to, and a comment that synthesised a verdict here would be the
 * trusted side reviewing the pull request.
 */
export function timeoutBody(
  links: UiLinks,
  run: RunRecord,
  projection: Projection,
  timeoutMs: number,
): string {
  const { reported, unfinished } = coverage(projection);
  const minutes = Math.round(timeoutMs / 60_000);
  const lines = [
    `**Cujo did not finish this review.** The turn reached its ${minutes} minute ceiling`,
    unfinished.length > 0
      ? `with ${unfinished.map((n) => `\`${n}\``).join(", ")} still running, so no review was posted.`
      : "before a review was posted.",
  ];
  let body = lines.join(" ");

  if (reported.length > 0) {
    body += `\n\nWhat had already been measured, from ${reported.length} of ${CHECK_NAMES.length} checks:\n\n`;
    body += reported.map((name) => `- \`${name}\` reported`).join("\n");
  } else {
    body += "\n\nNo check reported before the ceiling, so there is nothing to show.";
  }

  const operational = projection.findings.filter(isOperationalRule);
  const correctness = projection.findings.filter(
    (f) => f.severity === "critical" && !isMaliceClaim(f),
  );
  if (correctness.length > 0) {
    body += `\n\nFrom the reports that did land:\n\n${correctness.map(bullet).join("\n")}`;
  }
  if (operational.length > 0) {
    body += `\n\nGaps in the evidence itself, which say nothing about this code:\n\n${operational
      .map(bullet)
      .join("\n")}`;
  }

  const held = heldClaims(projection.findings);
  if (held > 0) {
    const subject = held === 1 ? "One finding is" : `${held} findings are`;
    const why = "because an accusation reaches a pull request only once somebody has allowed it";
    body += `\n\n${subject} held for a person to see first, and is not named here ${why}.`;
  }

  body += "\n\nPush again to run the review from a clean session.";
  return body + evidenceLink(links, run);
}

/**
 * A review that posted on thin evidence (decision 110).
 *
 * The review on this pull request was composed by `github-mcp` from the agent's
 * own tool arguments, so its finding count is the agent's count. Cujo re-derives
 * the hard rules afterwards, by which time nothing can be prevented — the review
 * is already posted under the bot's name. The operational rules are the half of
 * that re-derivation the author has a use for, and they reached only the board.
 */
export function evidenceGapBody(
  links: UiLinks,
  run: RunRecord,
  operational: readonly Finding[],
): string {
  const lede =
    "**The review above ran on thinner evidence than it looks.** These say something about what Cujo could measure, never about this code, and they do not change the verdict:";
  const body = `${lede}\n\n${operational.map(bullet).join("\n")}`;
  return body + evidenceLink(links, run);
}

async function post(
  deps: AnnounceDeps,
  run: RunRecord,
  kind: AnnouncementKind,
  body: string,
): Promise<void> {
  if (!deps.claim(run.id, kind)) {
    deps.log.info("review.announce.skipped", { reason: "already_announced" });
    return;
  }
  const commentId = await deps.github.createComment(run.repo, run.prNumber, body);
  deps.log.info("review.announce.posted", { reason: kind, comment_id: commentId });
}

/**
 * Post what a timed-out run did measure, instead of nothing.
 *
 * Silence is the one outcome that carries no information, and it is what runs
 * `b5724912`, `c7bf0e13` and `ced0c934` each gave a pull request after half an
 * hour of real work.
 */
export async function announceTimeout(
  deps: AnnounceDeps,
  run: RunRecord,
  projection: Projection,
  timeoutMs: number,
): Promise<void> {
  await post(deps, run, "turn_timeout", timeoutBody(deps.links, run, projection, timeoutMs));
}

/**
 * Tell the author when the review that posted had gaps in its evidence.
 *
 * Silent when there are none, which is the common case, and silent when the run
 * posted no review at all — a run that said nothing has a different problem and
 * `announceTimeout` is the one that describes it.
 */
export async function announceEvidenceGaps(
  deps: AnnounceDeps,
  run: RunRecord,
  projection: Projection,
): Promise<void> {
  if (!projection.review) return;
  const operational = projection.findings.filter(isOperationalRule);
  if (operational.length === 0) return;
  await post(deps, run, "evidence_gap", evidenceGapBody(deps.links, run, operational));
}
