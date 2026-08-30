import { type SensorBlock, parseReport } from "@/lib/api/report";
import type { CheckState, Finding } from "@/lib/api/types";

/**
 * What one check amounts to, in a phrase short enough to sit at the end of a
 * timeline lane.
 *
 * The lane used to end with the worst finding's *title*, which is a sentence a
 * model wrote — "3 tests pass on base and fail on head" — in a twelve-rem
 * column, so every interesting lane ended in an ellipsis and the one thing a
 * reader could not do was read it. The title is not lost: it is in the findings
 * list, in full, and the lane now goes there.
 *
 * So this is deliberately not a summary. It is the smallest true thing about a
 * check: how many findings it produced and how bad the worst one was, or, when
 * the sandbox itself tripped, which alarm it was.
 */

/** The tone classes the timeline paints a lane with. */
export type VerdictTone = "text-sev-critical" | "text-sev-high" | "text-sev-info" | "text-fg-muted";

export interface Verdict {
  text: string;
  tone: VerdictTone;
}

/**
 * The sandbox's own alarms, worded for a lane and ordered worst first.
 *
 * The same five facts `alarms()` reports over the report card, said in two
 * words instead of five. Two wordings rather than one shared source because
 * they are for two different places: the card has a column to explain itself in
 * and this has none, and a phrase short enough here would be curt there.
 */
function alarm(block: SensorBlock): string | null {
  if (block.secret_probe?.decoy_in_egress) return "decoy leaked";
  if (block.secret_probe?.decoy_read) return "decoy read";
  if (block.derived?.egress_to_unknown_host) return "unknown egress";
  if (block.derived?.wrote_sensitive) return "sensitive write";
  if (block.derived?.wrote_outside_workspace) return "wrote outside";
  return null;
}

/** The worst alarm across every block of a report, or null when none tripped. */
export function reportAlarm(report: unknown): string | null {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor") return null;
  for (const block of parsed.blocks) {
    const tripped = alarm(block);
    if (tripped) return tripped;
  }
  return null;
}

export function checkVerdict(
  check: CheckState | undefined,
  findings: Finding[],
  /** `reportAlarm(check.report)`, hoisted so a re-render does not re-parse. */
  tripped: string | null,
): Verdict {
  if (!check) return { text: "not run", tone: "text-fg-muted" };
  if (check.status === "running") return { text: "running", tone: "text-fg-muted" };
  if (check.status === "error") return { text: "error", tone: "text-sev-critical" };

  const mine = findings.filter((finding) => finding.check === check.title);
  const critical = mine.filter((finding) => finding.severity === "critical").length;
  const warn = mine.filter((finding) => finding.severity === "warn").length;
  const info = mine.filter((finding) => finding.severity === "info").length;

  // Ahead of the count, and that is the point of having it: a check that read
  // the decoy said something the number of findings does not, and the number is
  // one click away in the list this lane scrolls to.
  if (tripped) {
    return { text: tripped, tone: critical > 0 ? "text-sev-critical" : "text-sev-high" };
  }

  if (critical > 0) return { text: `${critical} critical`, tone: "text-sev-critical" };
  if (warn > 0) return { text: `${warn} warn`, tone: "text-sev-high" };
  // Counted rather than folded into "ok": an advisory note is not nothing, and
  // a lane that says "ok" over one is the page overstating a clean result.
  if (info > 0) return { text: `${info} info`, tone: "text-sev-info" };
  return { text: "ok", tone: "text-sev-info" };
}
