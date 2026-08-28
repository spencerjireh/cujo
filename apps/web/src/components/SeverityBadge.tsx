import type { Severity } from "@/lib/api/types";

/**
 * The data model has three severities; the brand ramp has five. `warn` takes
 * the amber `high` slot, which is also the brand accent, and `critical` keeps
 * red so the two never blur (brand/brand.md, "Severity ramp").
 */
const STYLES: Record<Severity, string> = {
  critical: "text-sev-critical bg-sev-critical-bg",
  warn: "text-sev-high bg-sev-high-bg",
  info: "text-sev-info bg-sev-info-bg",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}
