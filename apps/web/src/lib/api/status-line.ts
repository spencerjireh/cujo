import type { ReviewMode, RunStatus } from "@/lib/api/types";

/**
 * One written sentence per run status.
 *
 * This began as a private constant on the run page, where it filled the room a
 * link preview has (decision 86). The docs plane needs the same seven
 * sentences to explain what a verdict means, and a second hand-typed copy is a
 * copy that drifts — the two surfaces would eventually describe `blocked`
 * differently, on the same site.
 *
 * The card builder in `apps/cujo` has its own wording. That is not duplication
 * this can remove: `@cujo/cujo` is not an importable dependency of this app,
 * which is why every wire type here is hand-written too.
 *
 * Keyed on `RunStatus` rather than typed loosely, so a status added in
 * `apps/cujo` fails the build here instead of rendering an empty line in two
 * places.
 */
export const STATUS_LINE: Record<RunStatus, string> = {
  running: "Running tests, edge cases, a boot check, and a dependency install.",
  clean: "No critical findings. Review posted.",
  blocked: "Review requested changes. The cujo/guard check fails.",
  dismissed: "A maintainer lifted the block. The findings stay.",
  error: "The run failed.",
  unproven: "Review posted, but no check returned results.",
  superseded: "A newer commit replaced this run.",
};

/**
 * `STATUS_LINE`, read through the run's mode (decision 135). One sentence
 * differs: `running` names the four checks, and a diff run starts none of
 * them. Every finished sentence is true of both reviews, so the record above
 * stays closed and the manual keeps quoting it.
 */
export function statusLine(status: RunStatus, mode: ReviewMode | undefined): string {
  if (status === "running" && mode === "diff") {
    return "Reviewing the diff against the repo's standards.";
  }
  return STATUS_LINE[status];
}
