"use client";

import { Chevron } from "@/components/icons/Chevron";
import { CHECK_NAMES, type CheckName, type RunSummary } from "@/lib/api/types";
import {
  OUTCOME_TONE,
  SEVERITY_ORDER,
  SEVERITY_TONE,
  TONE_FILL,
  TONE_TEXT,
  checkOutcome,
  checkSentence,
  checksOf,
  findingTotal,
} from "@/lib/board/tone";
import * as Tooltip from "@radix-ui/react-tooltip";
import { SEGMENT } from "./SensorStrip";

/**
 * One cell that says how a run went: which checks ran, and what they found.
 *
 * These were two columns, "Checks" and "Found", and a reader could not see
 * that the second was produced by the first: four squares in one place, a
 * coloured bar in another, and no line between them. Together they are one
 * reading — the sensors, then what the sensors found — and the severities are
 * spelled out beside the bar, because a bar with three tones and no legend on
 * the row was a bar only the author could read.
 *
 * Each square is a tooltip trigger and the cell carries a disclosure, so what
 * this row summarises can be read in place: hover a square for its check, or
 * open the row for all four with their timings. The squares and the chevron
 * sit above the row's stretched link (`Record.tsx`), which is otherwise what
 * every click on a row reaches.
 */

/** A check and the sentence its square speaks. */
export function checkLine(run: RunSummary, name: CheckName): string {
  return checkSentence(name, checksOf(run)[name]);
}

/** The per-severity counts, worst first, zeros left out. */
export function severityLine(run: RunSummary): string {
  const counts = run.digest?.findings;
  if (!counts) return "";
  return SEVERITY_ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
}

/** One letter each, beside the number: `2c 3w 1i`. The bar's tones say the rest. */
const INITIAL: Record<(typeof SEVERITY_ORDER)[number], string> = {
  critical: "c",
  warn: "w",
  info: "i",
};

export function ResultsCell({
  run,
  open,
  onToggle,
}: {
  run: RunSummary;
  open: boolean;
  onToggle: () => void;
}) {
  // No digest at all is not four checks that did nothing and nothing found, so
  // it says so rather than drawing four empty squares and a dash.
  if (!run.digest) return <span className="font-mono text-xs text-fg-muted">not folded</span>;
  const counts = run.digest.findings;
  const total = findingTotal(counts);
  const spoken = severityLine(run);

  return (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span className="sr-only">
          {CHECK_NAMES.map((name) => checkLine(run, name)).join(", ")}
        </span>
        {CHECK_NAMES.map((name) => (
          <Tooltip.Root key={name} delayDuration={150}>
            <Tooltip.Trigger asChild>
              {/* A button and not a span: a tooltip a keyboard cannot reach
                  is a tooltip half the readers never see. `relative z-10`
                  lifts it over the row's stretched link. */}
              <button
                type="button"
                aria-label={checkLine(run, name)}
                className={`relative z-10 h-3 w-2 rounded-[1px] ${SEGMENT[checkOutcome(checksOf(run)[name])]}`}
              />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={6}
                className="z-30 rounded-sm border border-line bg-bg-raised px-2 py-1 font-mono text-xs text-fg shadow-sm"
              >
                {checkLine(run, name)}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </span>

      {total === 0 ? (
        <span className="font-mono text-xs text-fg-muted">none found</span>
      ) : (
        <span className="flex items-center gap-2" title={spoken}>
          <span className="sr-only">{spoken}</span>
          <span className="flex h-1.5 w-12 gap-px" aria-hidden="true">
            {SEVERITY_ORDER.map((severity) =>
              counts[severity] > 0 ? (
                <span
                  key={severity}
                  className={`min-w-0.5 ${TONE_FILL[SEVERITY_TONE[severity]]}`}
                  style={{ width: `${(counts[severity] / total) * 100}%` }}
                />
              ) : null,
            )}
          </span>
          {/* The counts, spelled out in their tones. The bar says the
              proportions; this says the numbers, which is what a reader
              deciding whether to open the run wants. */}
          <span className="flex gap-1.5 font-mono text-xs" aria-hidden="true">
            {SEVERITY_ORDER.map((severity) =>
              counts[severity] > 0 ? (
                <span key={severity} className={TONE_TEXT[SEVERITY_TONE[severity]]}>
                  {counts[severity]}
                  {INITIAL[severity]}
                </span>
              ) : null,
            )}
          </span>
        </span>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Hide the checks" : "Show the checks"}
        className="relative z-10 ml-auto flex h-5 w-5 items-center justify-center text-fg-muted transition-colors hover:text-fg"
      >
        <Chevron open={open} />
      </button>
    </span>
  );
}

/**
 * The row a disclosure opens: one line per check, in the order the squares
 * are drawn, with how it ended and how long it took. The same sentences the
 * tooltips speak, all at once.
 */
export function ResultsDetail({ run }: { run: RunSummary }) {
  const checks = checksOf(run);
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 font-mono text-xs">
      {CHECK_NAMES.map((name) => {
        const check = checks[name];
        const outcome = checkOutcome(check);
        // The name in the tone its ring is drawn in, so the row and the star
        // read alike; the rest of the line is the sentence the tooltip speaks.
        const sentence = checkSentence(name, check);
        return (
          <div key={name} className="contents">
            <dt className={`flex items-center gap-2 ${TONE_TEXT[OUTCOME_TONE[outcome]]}`}>
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-2 rounded-[1px] ${SEGMENT[outcome]}`}
              />
              {name}
            </dt>
            <dd className="text-fg-muted">{sentence.slice(name.length + 2)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
