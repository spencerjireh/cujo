"use client";

import { CHECK_NAMES, type CheckName, type CheckState, type Finding } from "@/lib/api/types";
import { duration, elapsedMs } from "@/lib/format";

/**
 * The four checks on one shared time axis.
 *
 * A grid of independent status cards would lose the thing worth seeing: the
 * checks run concurrently in one sandbox, so *when* one went red relative to
 * the others is the information. Lanes are positioned from the startedAt and
 * endedAt that apps/cujo stamps on each thread; when a run predates those
 * fields the lanes fall back to plain state, which is why every offset is
 * computed defensively.
 *
 * A lane is split where `timings` says it can be. `sandboxMs` is what the
 * sensors measured inside the sandbox — the pull request's own code actually
 * executing — and the rest is the model deciding what to make of it. That
 * division is the single claim this product makes that a linter cannot, and
 * `apps/cujo` has published it since commit 513d35f without anything drawing
 * it. It is drawn as strength and not as a second hue: the lane already
 * carries the check's outcome in its colour, and a lane saying two things in
 * two colours would be the mistake the chamber's blue rule exists to avoid.
 */

interface Lane {
  name: CheckName;
  check: CheckState | undefined;
  offsetMs: number | null;
  lengthMs: number | null;
  outcome: string;
  tone: string;
  /**
   * How much of the lane the sandbox accounted for, 0–1. Null when the check
   * reported no `timings`, which every run predating them does.
   */
  sandboxShare: number | null;
}

/**
 * The sandbox's share of a check's wall time.
 *
 * Measured against `wallMs` when the check reported one and against the lane
 * otherwise, and clamped: `sandboxMs` is summed from what `sniff.py` reported
 * for its own runs, so a concurrent sensor can push it past the wall clock, and
 * a bar wider than the lane it sits in would be a drawing that is wrong.
 */
function sandboxShare(check: CheckState | undefined, lengthMs: number | null): number | null {
  const sandboxMs = check?.timings?.sandboxMs;
  if (typeof sandboxMs !== "number" || sandboxMs <= 0) return null;
  const whole = check?.timings?.wallMs ?? lengthMs;
  if (typeof whole !== "number" || whole <= 0) return null;
  return Math.min(1, sandboxMs / whole);
}

function outcomeOf(check: CheckState | undefined, findings: Finding[]): [string, string] {
  if (!check) return ["not run", "text-fg-muted"];
  if (check.status === "running") return ["running", "text-fg-muted"];
  if (check.status === "error") return ["error", "text-sev-critical"];
  const worst = findings
    .filter((finding) => finding.check === check.title)
    .sort((a, b) => (a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0))[0];
  if (worst?.severity === "critical") return [worst.title, "text-sev-critical"];
  if (worst?.severity === "warn") return [worst.title, "text-sev-high"];
  return ["ok", "text-sev-info"];
}

export function ChecksTimeline({
  checks,
  findings,
}: {
  checks: CheckState[];
  findings: Finding[];
}) {
  const byName = new Map(checks.filter((check) => check.isCheck).map((c) => [c.title, c]));

  const starts = checks
    .map((check) => (check.startedAt ? Date.parse(check.startedAt) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  const origin = starts.length > 0 ? Math.min(...starts) : null;

  const lanes: Lane[] = CHECK_NAMES.map((name) => {
    const check = byName.get(name);
    const [outcome, tone] = outcomeOf(check, findings);
    const started = check?.startedAt ? Date.parse(check.startedAt) : Number.NaN;
    const length = elapsedMs(check?.startedAt, check?.endedAt);
    return {
      name,
      check,
      offsetMs: origin !== null && Number.isFinite(started) ? started - origin : null,
      lengthMs: length,
      outcome,
      tone,
      sandboxShare: sandboxShare(check, length),
    };
  });

  const span = Math.max(1, ...lanes.map((lane) => (lane.offsetMs ?? 0) + (lane.lengthMs ?? 0)));
  const hasTiming = lanes.some((lane) => lane.lengthMs !== null);
  const hasSplit = lanes.some((lane) => lane.sandboxShare !== null);

  return (
    <section aria-label="Checks">
      <h2 className="mb-3 text-lg">Checks</h2>
      <ul className="flex flex-col gap-1.5">
        {lanes.map((lane) => {
          const left = ((lane.offsetMs ?? 0) / span) * 100;
          const width = lane.lengthMs === null ? null : Math.max(1.5, (lane.lengthMs / span) * 100);
          const running = lane.check?.status === "running";
          // Null unless the check reported a sandbox measurement and the lane
          // has a width to divide. Zero is not drawn either: a check that spent
          // no time in the sandbox has one part, not two.
          const splitWidth =
            width === null || !lane.sandboxShare ? null : Math.max(width * lane.sandboxShare, 0.6);
          return (
            <li
              key={lane.name}
              className="grid grid-cols-[7rem_1fr] items-center gap-3 sm:grid-cols-[7rem_1fr_12rem]"
            >
              <span className="font-mono text-sm text-fg-muted">{lane.name}</span>
              <div
                className="relative h-6 overflow-hidden rounded-sm bg-bg-raised"
                role="presentation"
              >
                {lane.check ? (
                  <span
                    className={`absolute inset-y-0 rounded-sm ${running ? "animate-pulse bg-fg-muted" : "bg-current"} ${lane.tone}`}
                    style={
                      width === null
                        ? { left: 0, right: 0, opacity: 0.35 }
                        : // Reduced when a split is drawn on top of it, so the
                          // full-strength part is the sandbox and the rest is
                          // visibly the remainder.
                          {
                            left: `${left}%`,
                            width: `${width}%`,
                            opacity: splitWidth === null ? 1 : 0.4,
                          }
                    }
                  />
                ) : null}
                {splitWidth === null ? null : (
                  <span
                    className={`absolute inset-y-0 rounded-sm bg-current ${lane.tone}`}
                    style={{ left: `${left}%`, width: `${splitWidth}%` }}
                  />
                )}
              </div>
              <span className={`font-mono text-xs sm:text-sm ${lane.tone} truncate`}>
                {lane.outcome}
                {lane.check ? (
                  <span className="ml-2 text-fg-muted">
                    {duration(lane.check.startedAt, lane.check.endedAt) ?? ""}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {hasTiming ? (
        <p className="mt-2 font-mono text-xs text-fg-muted">
          Lanes share one time axis,{" "}
          {duration(new Date(0).toISOString(), new Date(span).toISOString())} end to end.
          {hasSplit
            ? " The solid part of a lane is the sandbox executing the pull request; the rest is the model reading what came back."
            : ""}
        </p>
      ) : null}
    </section>
  );
}
