"use client";

import {
  CHECK_NAMES,
  type CheckName,
  type CheckState,
  type Finding,
  type SetupTimings,
} from "@/lib/api/types";
import { type SetupWindow, setupWindow } from "@/lib/board/setup";
import { duration, elapsedMs } from "@/lib/format";
import type { ReactNode } from "react";

/**
 * A run's whole envelope on one shared time axis: the setup window, then the
 * four checks.
 *
 * A grid of independent status cards would lose the thing worth seeing: the
 * checks run concurrently in one sandbox, so *when* one went red relative to
 * the others is the information. Lanes are positioned from the startedAt and
 * endedAt that apps/cujo stamps on each thread; when a run predates those
 * fields the lanes fall back to plain state, which is why every offset is
 * computed defensively.
 *
 * The axis used to begin at the earliest check, which made this drawing agree
 * with itself and disagree with the run. Decision 67 measured what comes
 * before — a run does seconds of execution inside minutes of wall clock, and
 * the window from the first turn to the first check is the largest part of the
 * remainder — so a page that accounts for a run's time and started the clock
 * after the expensive part was contradicting its own measurement. The setup
 * lane is drawn first and the origin moves back to hold it.
 *
 * A lane is split where the run said it can be, and both splits are the same
 * claim: the head of the bar at full strength is a machine doing work, and the
 * remainder is the model deciding what to make of it. On a check that is
 * `sandboxMs`, the pull request's own code executing. On setup it is Daytona
 * provisioning the sandbox. It is drawn as strength and never as a second hue:
 * the lane already carries its outcome in its colour, and a lane saying two
 * things in two colours would be the mistake the chamber's blue rule exists to
 * avoid.
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

/** A span in milliseconds, worded the way every other duration on the page is. */
function span(ms: number): string {
  return duration(new Date(0).toISOString(), new Date(ms).toISOString()) ?? "";
}

/**
 * One bar on the axis.
 *
 * Shared by the setup lane and the four checks so the two are drawn by one
 * piece of code: they are the same measurement on the same axis, and a second
 * copy of this markup is how they would drift apart.
 */
function Bar({
  left,
  width,
  running,
  tone,
  solidWidth,
  drawn,
}: {
  left: number;
  /** Null when nothing measured the length, which fills the lane faintly. */
  width: number | null;
  running: boolean;
  tone: string;
  /** The full-strength head of the bar, or null when there is no split. */
  solidWidth: number | null;
  drawn: boolean;
}) {
  return (
    <div className="relative h-6 overflow-hidden rounded-sm bg-bg-raised" role="presentation">
      {drawn ? (
        <span
          className={`absolute inset-y-0 rounded-sm ${running ? "animate-pulse bg-fg-muted" : "bg-current"} ${tone}`}
          style={
            width === null
              ? { left: 0, right: 0, opacity: 0.35 }
              : // Reduced when a split is drawn on top of it, so the
                // full-strength part is the machine and the rest is visibly
                // the remainder.
                {
                  left: `${left}%`,
                  width: `${width}%`,
                  opacity: solidWidth === null ? 1 : 0.4,
                }
          }
        />
      ) : null}
      {solidWidth === null ? null : (
        <span
          className={`absolute inset-y-0 rounded-sm bg-current ${tone}`}
          style={{ left: `${left}%`, width: `${solidWidth}%` }}
        />
      )}
    </div>
  );
}

/** A row: the label, the bar, and what the row amounts to. */
function Row({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[7rem_1fr] items-center gap-3 sm:grid-cols-[7rem_1fr_12rem]">
      <span className="font-mono text-sm text-fg-muted">{label}</span>
      {children}
      {note}
    </li>
  );
}

export function ChecksTimeline({
  checks,
  findings,
  setup,
}: {
  checks: CheckState[];
  findings: Finding[];
  setup?: SetupTimings | null;
}) {
  const byName = new Map(checks.filter((check) => check.isCheck).map((c) => [c.title, c]));
  const window = setupWindow(setup);

  const starts = checks
    .map((check) => (check.startedAt ? Date.parse(check.startedAt) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  // The axis begins wherever the run did. `window.startedAt` is the run's first
  // `turn.created`, which is earlier than any check by construction — but it is
  // taken as a minimum rather than assumed, because a stamp that disagrees with
  // that should move the origin, not be drawn off the left edge.
  const originCandidates = window === null ? starts : [window.startedAt, ...starts];
  const origin = originCandidates.length > 0 ? Math.min(...originCandidates) : null;

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

  const setupEndMs = window === null || origin === null ? 0 : window.endedAt - origin;
  const total = Math.max(
    1,
    setupEndMs,
    ...lanes.map((lane) => (lane.offsetMs ?? 0) + (lane.lengthMs ?? 0)),
  );
  const hasTiming = lanes.some((lane) => lane.lengthMs !== null);
  const hasSplit = lanes.some((lane) => lane.sandboxShare !== null);

  return (
    <section aria-label="Checks">
      <h2 className="mb-3 text-lg">Checks</h2>
      <ul className="flex flex-col gap-1.5">
        {window === null || origin === null ? null : (
          <SetupRow window={window} origin={origin} total={total} />
        )}
        {lanes.map((lane) => {
          const left = ((lane.offsetMs ?? 0) / total) * 100;
          const width =
            lane.lengthMs === null ? null : Math.max(1.5, (lane.lengthMs / total) * 100);
          const running = lane.check?.status === "running";
          // Null unless the check reported a sandbox measurement and the lane
          // has a width to divide. Zero is not drawn either: a check that spent
          // no time in the sandbox has one part, not two.
          const solidWidth =
            width === null || !lane.sandboxShare ? null : Math.max(width * lane.sandboxShare, 0.6);
          return (
            <Row
              key={lane.name}
              label={lane.name}
              note={
                <span className={`font-mono text-xs sm:text-sm ${lane.tone} truncate`}>
                  {lane.outcome}
                  {lane.check ? (
                    <span className="ml-2 text-fg-muted">
                      {duration(lane.check.startedAt, lane.check.endedAt) ?? ""}
                    </span>
                  ) : null}
                </span>
              }
            >
              <Bar
                left={left}
                width={width}
                running={running}
                tone={lane.tone}
                solidWidth={solidWidth}
                drawn={!!lane.check}
              />
            </Row>
          );
        })}
      </ul>
      {hasTiming || window !== null ? (
        <p className="mt-2 font-mono text-xs text-fg-muted">
          Lanes share one time axis, {span(total)} end to end.
          {window === null
            ? ""
            : " Setup is the window before the first check existed; the solid head of it is Daytona provisioning the sandbox."}
          {hasSplit
            ? " The solid part of a check is the sandbox executing the pull request; the rest is the model reading what came back."
            : ""}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The setup lane.
 *
 * Muted rather than toned, because it has no verdict to carry: setup is not a
 * check and never produced a finding. It is the one row on this axis that says
 * how long the run spent getting ready, which decision 67 measured and nothing
 * drew.
 */
function SetupRow({
  window,
  origin,
  total,
}: {
  window: SetupWindow;
  origin: number;
  total: number;
}) {
  const left = ((window.startedAt - origin) / total) * 100;
  const width = Math.max(1.5, (window.lengthMs / total) * 100);
  const solidWidth =
    window.provisionShare === null ? null : Math.max(width * window.provisionShare, 0.6);

  return (
    <Row
      label="setup"
      note={
        <span className="truncate font-mono text-xs text-fg-muted sm:text-sm">
          {window.messages} {window.messages === 1 ? "message" : "messages"}
          <span className="ml-2">{span(window.lengthMs)}</span>
        </span>
      }
    >
      <Bar
        left={left}
        width={width}
        running={false}
        tone="text-fg-muted"
        solidWidth={solidWidth}
        drawn={true}
      />
    </Row>
  );
}
