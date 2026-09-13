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
  running: "Review running: tests, probes, a smoke boot, and dependency detonation.",
  clean: "No critical finding. The advisory review posted.",
  blocked: "Blocking review posted as REQUEST_CHANGES; the cujo/guard check fails.",
  dismissed: "The block was lifted by a maintainer. The observation stands.",
  error: "The run ended in error.",
  unproven: "The review posted with no evidence: not one check returned a report.",
  superseded: "Replaced by a newer commit on this PR.",
};

/**
 * `STATUS_LINE`, read through the run's mode (decision 135). One sentence
 * differs: `running` names the four checks, and a diff run starts none of
 * them. Every finished sentence is true of both reviews, so the record above
 * stays closed and the manual keeps quoting it.
 */
export function statusLine(status: RunStatus, mode: ReviewMode | undefined): string {
  if (status === "running" && mode === "diff") {
    return "Diff review running: reading the diff against the repository's standards.";
  }
  return STATUS_LINE[status];
}
