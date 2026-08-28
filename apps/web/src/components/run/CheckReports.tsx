"use client";

import { alarms, parseReport } from "@/lib/api/report";
import type { CheckState } from "@/lib/api/types";
import { duration } from "@/lib/format";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import { RawJson } from "./report/RawJson";
import { SensorReport } from "./report/SensorReport";

/** One collapsible section per check that returned something. */
function CheckReport({ check }: { check: CheckState }) {
  const parsed = parseReport(check.report);
  // A check that tripped anything is worth opening without being asked. This
  // asks alarms() rather than testing one flag, so a decoy-secret read or a
  // sensitive write opens the report too.
  const [open, setOpen] = useState(
    parsed.kind === "sensor" && parsed.blocks.some((block) => alarms(block).length > 0),
  );

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
          parsed.blocks.map((block, index) => (
            <SensorReport key={block.label ?? `block-${index}`} block={block} />
          ))
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
      {reported.map((check) => (
        <CheckReport key={check.threadId} check={check} />
      ))}
    </section>
  );
}
