import { STATUS_LINE } from "@/lib/api/status-line";
import type { ReviewMode, RunStatus } from "@/lib/api/types";

/**
 * What a run means for the person reading it, and what they do next (decision
 * 175). The run page leads with this, and an owner's activity page words each
 * pull request that needs them with the same sentences, so the two never
 * disagree about what a block asks of somebody.
 *
 * `STATUS_LINE` stays the record of what Cujo did; this is what the reader
 * does about it. Keyed on `RunStatus`, so a new status fails the build here.
 *
 * `closed` is the owner plane's word that the pull request merged or closed
 * (decision 179). It only changes a superseded run, which is then not
 * outdated by a newer commit but stopped because the pull request ended.
 */

const NEXT: Record<RunStatus, string | null> = {
  running: "Results appear as each check finishes.",
  clean: "Nothing to do.",
  blocked: "Fix and push, or a maintainer comments /cujo dismiss.",
  dismissed: "Nothing to do.",
  error: "Cujo failed. Comment /cujo review to run it again.",
  unproven: "Comment /cujo review to run it again.",
  superseded: "Open the newer run from the pull request.",
};

/** The one-line headline for a run's status. */
export function headline(
  status: RunStatus,
  critical: number,
  mode?: ReviewMode,
  closed = false,
): string {
  switch (status) {
    case "running":
      return mode === "diff" ? "Diff review running" : "Review running";
    case "clean":
      return "No blocking findings";
    case "blocked":
      return critical > 0
        ? `Blocked by ${critical} critical finding${critical === 1 ? "" : "s"}`
        : "Blocked";
    case "dismissed":
      return "Block lifted";
    case "error":
      return "Review failed";
    case "unproven":
      return "No results";
    case "superseded":
      return closed ? "Pull request closed before the review finished" : "Outdated";
  }
}

/** What the reader does next, or null when there is nothing to say. */
export function nextStep(status: RunStatus, closed = false): string | null {
  return status === "superseded" && closed ? null : NEXT[status];
}

/** What Cujo did, for the line under the headline. */
export function whatHappened(status: RunStatus, closed = false): string {
  return status === "superseded" && closed
    ? "Cujo stopped the review when the pull request closed."
    : STATUS_LINE[status];
}

/**
 * Splits a sentence around the PR commands, so a component can set each one
 * as code: `["Comment ", "/cujo review", " on the pull request"]`. Odd
 * indexes are commands.
 */
export function splitCommands(text: string): string[] {
  return text.split(/(\/cujo (?:dismiss|review))/);
}
