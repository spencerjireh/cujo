"use client";

import { needsAttention, parseReport } from "@/lib/api/report";
import type { CheckState } from "@/lib/api/types";
import { duration } from "@/lib/format";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useEffect, useRef, useState } from "react";
import { RawJson } from "./report/RawJson";
import { SensorReport } from "./report/SensorReport";

/** One collapsible section per check that returned something. */
function CheckReport({ check }: { check: CheckState }) {
  const parsed = parseReport(check.report);
  // A check that tripped anything, or that ran with a sensor down, is worth
  // opening without being asked. `some` over the blocks, so one blind interval
  // reported on both the roll-up and its run opens the card once.
  const attention = parsed.kind === "sensor" && parsed.blocks.some(needsAttention);
  const [open, setOpen] = useState(attention);
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

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-line">
      <Collapsible.Trigger className="flex w-full items-center justify-between gap-3 py-3 text-left">
        <span className="font-mono text-sm">{check.title}</span>
        <span className="flex items-center gap-3 font-mono text-xs text-fg-muted">
          {check.status === "error" ? (
            <span className="text-sev-critical">error</span>
          ) : parsed.kind === "empty" ? (
            <span>no report</span>
          ) : null}
          {duration(check.startedAt, check.endedAt) ?? ""}
          <span aria-hidden="true">{open ? "collapse" : "expand"}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="pb-4">
        {check.error ? (
          <p className="mb-3 font-mono text-xs text-sev-critical">{check.error}</p>
        ) : null}
        {parsed.kind === "sensor" ? (
          <>
            {parsed.blocks.map((block, index) => (
              <SensorReport key={block.label ?? `block-${index}`} block={block} />
            ))}
            {/* The tables are a reading of the report, not the report. Anything
                they have no column for -- the output tails, the per-check
                fields, a field added by a sandbox newer than this build -- is
                only here. Closed by default; it is the fallback, not the view. */}
            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-xs text-fg-muted">
                raw report
              </summary>
              <div className="mt-2">
                <RawJson value={parsed.raw} />
              </div>
            </details>
          </>
        ) : parsed.kind === "opaque" ? (
          <RawJson value={parsed.raw} />
        ) : (
          <p className="text-sm text-fg-muted">
            This check returned no report. The run records that as a finding.
          </p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function CheckReports({ checks }: { checks: CheckState[] }) {
  const reported = checks.filter((check) => check.isCheck);
  if (reported.length === 0) return null;

  return (
    <section aria-label="Check reports">
      <h2 className="mb-1 text-lg">Reports</h2>
      {/*
        Keyed by position rather than by thread id: the public plane publishes
        no harness handles, and the fold emits these in a fixed order, so the
        index is stable for as long as the list is.
      */}
      {reported.map((check, index) => (
        <CheckReport key={`${check.title}-${index}`} check={check} />
      ))}
    </section>
  );
}
