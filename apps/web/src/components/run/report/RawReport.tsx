"use client";

import { Chevron } from "@/components/icons/Chevron";
import type { SensorBlock } from "@/lib/api/report";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import { RawJson } from "./RawJson";

/**
 * The report as the sandbox wrote it, and how it was written.
 *
 * The tables above are a reading of the report, not the report. Anything they
 * have no column for — the output tails, the per-check fields, a field added by
 * a sandbox newer than this build — is only here. Closed by default; it is the
 * fallback, not the view.
 *
 * It was a native `<details>` with a `cursor-pointer` summary, which is a third
 * disclosure pattern on a page that now has one: the check card and the
 * provenance section are both a Collapsible with a `Chevron` and a row that is
 * the whole control.
 */
const SENSOR_LABELS: Record<string, string> = {
  proxy: "proxy",
  decoy: "decoy watcher",
  audit: "python hook",
  fs_diff: "filesystem",
};

export function RawReport({
  raw,
  /** The blocks whose sensor health lives under this disclosure, in order. */
  blocks = [],
}: {
  raw: unknown;
  blocks?: SensorBlock[];
}) {
  const [open, setOpen] = useState(false);
  const measured = blocks.filter((block) => block.sensors);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-6 border-t border-line">
      <Collapsible.Trigger className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-bg-raised">
        <span className="font-mono text-xs text-fg-muted">
          {measured.length > 0 ? "Raw report and sensor detail" : "Raw report"}
        </span>
        <Chevron open={open} className="text-fg-muted" />
      </Collapsible.Trigger>
      <Collapsible.Content className="pb-2">
        {measured.map((block, index) => (
          <div key={block.label ?? `block-${index}`} className="mt-2">
            <p className="font-mono text-xs text-fg-muted">
              How this was measured
              {/* Named the way the block above names itself, including the
                  roll-up, so three lists of four sensors are told apart. */}
              {block.label ? ` — ${block.label}` : measured.length > 1 ? " — all runs" : ""}
            </p>
            {/* The four detail strings the dotted strip used to carry. They are
                reference, not a verdict: the verdict is the coverage sentence at
                the top of the block, which is why they moved down here rather
                than being said in both places. */}
            <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-3 font-mono text-xs">
              {Object.entries(block.sensors ?? {}).map(([name, sensor]) => (
                <div key={name} className="col-span-2 grid grid-cols-subgrid py-0.5">
                  <dt className={sensor.armed === false ? "text-sev-high" : "text-fg-muted"}>
                    {SENSOR_LABELS[name] ?? name}
                  </dt>
                  <dd className={sensor.armed === false ? "text-sev-high" : "text-fg-muted"}>
                    {sensor.armed === false
                      ? "off"
                      : sensor.armed === true
                        ? "watching"
                        : "unknown"}
                    {sensor.detail ? ` · ${sensor.detail}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <RawJson value={raw} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
