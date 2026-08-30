"use client";

import { Chevron } from "@/components/icons/Chevron";
import { needsAttention, parseReport } from "@/lib/api/report";
import type { CheckState } from "@/lib/api/types";
import { compactCount, duration, usd } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useRef, useState } from "react";
import { RawReport } from "./report/RawReport";
import { SensorReport } from "./report/SensorReport";

/** What the timeline asks for: a check, and which ask this is. */
export interface PickedCheck {
  check: string;
  nonce: number;
}

/** One collapsible section per check that returned something. */
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
  // A check that tripped anything, or that ran with a sensor down, is worth
  // opening without being asked. `some` over the blocks, so one blind interval
  // reported on both the roll-up and its run opens the card once.
  const attention = parsed.kind === "sensor" && parsed.blocks.some(needsAttention);
  const [open, setOpen] = useState(attention);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // The initializer runs once, and a check mounts while it is still running --
  // `report: null`, nothing to be alarmed about yet. The report arrives later
  // over the stream, into the same component, so without this the card a
  // watcher most needs open is the one that stays shut. On the rising edge
  // only: a card the reader closed again stays closed.
  const wasAttention = useRef(attention);
  useEffect(() => {
    if (attention && !wasAttention.current) setOpen(true);
    wasAttention.current = attention;
  }, [attention]);

  /**
   * Somebody picked this check's lane on the timeline.
   *
   * On the rising edge of the ask and not on the value, for the reason the
   * effect above is written that way and for one more: the run re-renders every
   * few seconds while it is live, and a card that re-opened itself on each of
   * those would be a card a reader cannot close.
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
          {/* What this one check cost, beside how long it took. Hidden on a
              narrow screen, where the row already carries four things. */}
          {check.usage ? (
            <span className="hidden sm:inline">
              {compactCount(check.usage.inputTokens + check.usage.outputTokens)} tok
              {typeof check.usage.costUsd === "number" ? ` · ${usd(check.usage.costUsd)}` : ""}
            </span>
          ) : null}
          {duration(check.startedAt, check.endedAt) ?? ""}
          <Chevron open={open} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="pb-4">
        {check.error ? (
          <p className="mt-3 font-mono text-xs text-sev-critical">{check.error}</p>
        ) : null}
        {parsed.kind === "sensor" ? (
          <>
            {parsed.blocks.map((block, index) => (
              <SensorReport
                key={block.label ?? `block-${index}`}
                block={block}
                check={check.title}
                index={index}
                total={parsed.blocks.length}
              />
            ))}
            <RawReport raw={parsed.raw} blocks={parsed.blocks} />
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
