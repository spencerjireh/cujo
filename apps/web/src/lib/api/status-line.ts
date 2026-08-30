import type { RunStatus } from "@/lib/api/types";

/**
 * One written sentence per run status.
 *
 * This began as a private constant on the run page, where it filled the room a
 * link preview has (decision 86). The docs plane needs the same eight
 * sentences to explain what a verdict means, and a second hand-typed copy is a
 * copy that drifts — the two surfaces would eventually describe
 * `blocked_unattended` differently, on the same site.
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
  blocked_pending: "Blocked — waiting for a human.",
  blocked_unattended: "Blocking review posted; no human was asked.",
  blocked_posted: "Blocking review posted as REQUEST_CHANGES.",
  denied: "The block was rejected. Nothing was posted.",
  error: "The run ended in error.",
  superseded: "Replaced by a newer commit on this PR.",
};
