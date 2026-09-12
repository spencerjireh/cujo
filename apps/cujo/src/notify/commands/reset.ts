import type { CommandDeps } from "./index";

/**
 * What the run side answers a reset with. `busy` is the one refusal: a run is
 * still following a turn on the review session, and forgetting the session
 * under it would strand that run.
 */
export type ResetOutcome = { kind: "reset"; sessions: number } | { kind: "busy"; runId: string };

/**
 * Forget a pull request's sessions, so its next review starts on a fresh one
 * (Contract 5, decision 123).
 *
 * A session is pinned to the spec it was created with (decision 16): a rubric
 * or model change never reaches a pull request already under review, and
 * before this the only way out was a new pull request. Behind authorization
 * like `watch`, because the server that may see a repo's reviews is the one
 * that may restart them.
 */
export function reset(deps: CommandDeps, input: { repo: string; prNumber: number | null }): string {
  if (!input.prNumber || !Number.isInteger(input.prNumber) || input.prNumber < 1) {
    return "That does not look like a pull request number.";
  }
  const outcome = deps.resetSession(input.repo, input.prNumber);
  if (outcome.kind === "busy") {
    deps.log.warn("session.reset.refused", {
      repo: input.repo,
      pr_number: input.prNumber,
      run_id: outcome.runId,
    });
    return `\`${input.repo}#${input.prNumber}\` has a review in progress. Wait for it to finish, or push a new commit, then try again.`;
  }
  deps.log.info("session.reset", {
    repo: input.repo,
    pr_number: input.prNumber,
    active: outcome.sessions,
  });
  if (outcome.sessions === 0) {
    return `\`${input.repo}#${input.prNumber}\` had no session to forget; its next review starts fresh anyway.`;
  }
  return `Forgot \`${input.repo}#${input.prNumber}\`'s session. The next push, or \`/cujo review\` on the pull request, starts a new one.`;
}
