import type { RunStatus } from "@/lib/api/types";

/**
 * Status carries meaning beyond colour, so each one is spelled out rather than
 * encoded as a dot: an operator scanning the list needs to tell `blocked_posted`
 * from `blocked_pending` at a glance.
 */
const STYLES: Record<RunStatus, string> = {
  running: "text-fg-muted bg-sev-low-bg",
  clean: "text-sev-info bg-sev-info-bg",
  blocked_pending: "text-sev-high bg-sev-high-bg",
  blocked_unattended: "text-sev-critical bg-sev-critical-bg",
  blocked_posted: "text-sev-critical bg-sev-critical-bg",
  denied: "text-fg-muted bg-sev-low-bg",
  error: "text-sev-critical bg-sev-critical-bg",
  superseded: "text-fg-muted bg-sev-low-bg",
};

const LABELS: Record<RunStatus, string> = {
  running: "running",
  clean: "clean",
  blocked_pending: "awaiting approval",
  blocked_unattended: "blocked",
  blocked_posted: "blocked",
  denied: "denied",
  error: "error",
  superseded: "superseded",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${STYLES[status]}`}
    >
      {status === "running" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {LABELS[status]}
    </span>
  );
}
