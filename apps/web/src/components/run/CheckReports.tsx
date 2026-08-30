"use client";

import { Chevron } from "@/components/icons/Chevron";
import { type SensorBlock, parseReport } from "@/lib/api/report";
import type { CheckState, UsageTotals } from "@/lib/api/types";
import { compactCount, duration, usd } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useRef, useState } from "react";
import { RawReport } from "./report/RawReport";
import { SensorReport } from "./report/SensorReport";
import { SensorStatus } from "./report/SensorStatus";

/** What the timeline asks for: a check, and which ask this is. */
export interface PickedCheck {
  check: string;
  nonce: number;
}

/**
 * What this one check cost the model, in words. It sat on the trigger row as
 * `12.4k tok · $0.03`, beside the duration, where a PR author had to know
 * what `tok` was and that the number was two counts added together. The row
 * keeps the duration, which is the one figure worth a glance before opening.
 */
function CostLine({ usage }: { usage?: UsageTotals | null }) {
  if (!usage) return null;
  const parts = [
    Number.isFinite(usage.inputTokens) ? `input ${compactCount(usage.inputTokens)} tokens` : null,
    Number.isFinite(usage.outputTokens)
      ? `output ${compactCount(usage.outputTokens)} tokens`
      : null,
    typeof usage.costUsd === "number" ? usd(usage.costUsd) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return <p className="mt-3 font-mono text-xs text-fg-muted">Model {parts.join(" · ")}</p>;
}

/**
 * One line over a report of many probes: how many, how many passed, and how
 * long the slowest and quickest took. Passed means the command exited zero.
 */
function probeSummary(blocks: SensorBlock[]): string {
  const commands = blocks.flatMap((block) => (block.command ? [block.command] : []));
  const passed = commands.filter((command) => command.exit === 0).length;
  const durations = commands.flatMap((command) =>
    command.duration_s !== null ? [command.duration_s] : [],
  );
  const noun = blocks.length === 1 ? "probe" : "probes";
  let line = `${blocks.length} ${noun}, ${passed} passed`;
  if (durations.length > 0) {
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    line += min === max ? `, ${min} s` : `, ${min}–${max} s`;
  }
  return line;
}

/**
 * The blocks of one report. A single block is drawn as it always was. Several
 * are a detonation or a probe sweep, and go behind one summary line, closed:
 * the line says how many probes ran and how many passed, and the blocks are
 * for a reader who opens it. It used to open on its own when a block tripped,
 * which was one more thing unfolding on a page whose verdict card and timeline
 * had already said what tripped. Once per report, not per block, the sensor
 * health is said above this by `SensorStatus`.
 */
function Blocks({ blocks, check }: { blocks: SensorBlock[]; check: string }) {
  const [open, setOpen] = useState(false);

  const rendered = blocks.map((block, index) => (
    <SensorReport
      key={block.label ?? `block-${index}`}
      block={block}
      check={check}
      index={index}
      total={blocks.length}
    />
  ));
  if (blocks.length <= 1) return <div className="mt-3">{rendered}</div>;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-3">
      <Collapsible.Trigger className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-bg-raised">
        <span className="font-mono text-xs">{probeSummary(blocks)}</span>
        <Chevron open={open} className="text-fg-muted" />
      </Collapsible.Trigger>
      <Collapsible.Content>{rendered}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/**
 * One collapsible section per check that returned something.
 *
 * Closed until asked. A card used to open itself when its report tripped
 * anything or ran with a sensor down, and to open again when such a report
 * arrived over the stream. That put the longest section of the page on screen
 * before the reader had chosen it, under a verdict card and a timeline that
 * had already said what was wrong; the timeline lane is now the one thing
 * that opens a card, and it opens it on purpose.
 */
function CheckReport({
  check,
  /** Rises when this card is the one a timeline lane asked for. */
  summoned,
  onDeliver,
}: {
  check: CheckState;
  summoned: number;
  onDeliver: (trigger: HTMLButtonElement) => void;
}) {
  const parsed = parseReport(check.report);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Somebody picked this check's lane on the timeline.
   *
   * On the rising edge of the ask and not on the value: the run re-renders
   * every few seconds while it is live, and a card that re-opened itself on
   * each of those would be a card a reader cannot close.
   */
  const delivered = useRef(summoned);
  useEffect(() => {
    if (summoned === delivered.current) return;
    delivered.current = summoned;
    if (summoned === 0) return;
    setOpen(true);
    const trigger = triggerRef.current;
    if (trigger) onDeliver(trigger);
  }, [summoned, onDeliver]);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-line">
      {/* The whole row is the trigger and always has been. What changed is that
          it now looks like one: a ground under the pointer, and a glyph where
          two words used to sit and read as the only part that was clickable. */}
      <Collapsible.Trigger
        ref={triggerRef}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-3 text-left hover:bg-bg-raised"
      >
        <span className="font-mono text-sm">{check.title}</span>
        <span className="flex items-center gap-3 font-mono text-xs text-fg-muted">
          {check.status === "error" ? (
            <span className="text-sev-critical">error</span>
          ) : parsed.kind === "empty" ? (
            <span>no report</span>
          ) : null}
          {duration(check.startedAt, check.endedAt) ?? ""}
          <Chevron open={open} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="pb-4">
        {check.error ? (
          <p className="mt-3 font-mono text-xs text-sev-critical">{check.error}</p>
        ) : null}
        <CostLine usage={check.usage} />
        {parsed.kind === "sensor" ? (
          <>
            <SensorStatus block={parsed.blocks[0]} />
            <Blocks blocks={parsed.blocks} check={check.title} />
            <RawReport raw={parsed.raw} />
          </>
        ) : parsed.kind === "opaque" ? (
          <RawReport raw={parsed.raw} />
        ) : (
          <p className="mt-3 text-sm text-fg-muted">
            This check returned no report. The run records that as a finding.
          </p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function CheckReports({
  checks,
  picked,
}: {
  checks: CheckState[];
  /** The lane a reader picked on the timeline, if they picked one. */
  picked?: PickedCheck | null;
}) {
  const reported = checks.filter((check) => check.isCheck);

  /**
   * Bring the picked card into view, and put the keyboard on it.
   *
   * Moving focus is the part that matters, and it is the same argument the
   * record makes for its rows: a scroll on its own is a change nobody using a
   * keyboard or a screen reader is told about, and the card that opened is then
   * somewhere behind wherever the Tab order still is. `preventScroll` because
   * the scroll is already happening, smoothly, and the browser's own would jump
   * over it.
   */
  const deliver = useCallback((trigger: HTMLButtonElement) => {
    const smooth = !prefersReducedMotion();
    trigger.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    trigger.focus({ preventScroll: true });
  }, []);

  if (reported.length === 0) return null;

  return (
    <section aria-label="Check reports">
      <h2 className="mb-1 text-lg">Reports</h2>
      <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        What each sub-agent watched happen in the sandbox: where the code called out to, what it
        read, what it wrote, what it ran.
      </p>
      {/*
        Keyed by position rather than by thread id: the public plane publishes
        no harness handles, and the fold emits these in a fixed order, so the
        index is stable for as long as the list is.
      */}
      {reported.map((check, index) => (
        <CheckReport
          key={`${check.title}-${index}`}
          check={check}
          summoned={picked && picked.check === check.title ? picked.nonce : 0}
          onDeliver={deliver}
        />
      ))}
    </section>
  );
}
