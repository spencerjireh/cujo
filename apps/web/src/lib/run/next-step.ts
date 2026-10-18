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
 */

const NEXT: Record<RunStatus, string | null> = {
  running: "Results appear here as each check finishes. Nothing to do yet.",
  clean: "Nothing to do. The review on the pull request lists what ran.",
  blocked:
    "Fix the findings and push a new commit, or a maintainer with write access comments /cujo dismiss on the pull request.",
  dismissed: "Nothing to do. The findings stay on record.",
  error:
    "Cujo failed, not the pull request. Comment /cujo review on the pull request to run it again.",
  unproven:
    "No check returned a report, so nothing here was observed. Comment /cujo review on the pull request to run it again.",
  superseded: "A newer commit has its own run; open it from the pull request.",
};

/** The one-line headline for a run's status. */
export function headline(status: RunStatus, critical: number, mode?: ReviewMode): string {
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
      return "Block lifted by a maintainer";
    case "error":
      return "The review did not finish";
    case "unproven":
      return "Reviewed without evidence";
    case "superseded":
      return "A newer commit replaced this run";
  }
}

/** What the reader does next, or null when there is nothing to say. */
export function nextStep(status: RunStatus): string | null {
  return NEXT[status];
}

/** What Cujo did, for the line under the headline. */
export function whatHappened(status: RunStatus): string {
  return STATUS_LINE[status];
}

/**
 * Splits a sentence around the PR commands, so a component can set each one
 * as code: `["Comment ", "/cujo review", " on the pull request"]`. Odd
 * indexes are commands.
 */
export function splitCommands(text: string): string[] {
  return text.split(/(\/cujo (?:dismiss|review))/);
}
