"use client";

import { type SensorBlock, alarms } from "@/lib/api/report";
import { bytes } from "@/lib/format";
import { VirtualRows } from "./VirtualRows";

/**
 * The forensic view. This is the thing an operator reads before blocking a
 * merge, so the flags that decide the outcome sit above the raw evidence rather
 * than inside it. Every field is optional in the contract, so nothing here
 * assumes a value is present.
 */

function Alarms({ block }: { block: SensorBlock }) {
  const flags = alarms(block);
  if (flags.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-2">
      {flags.map((flag) => (
        <li
          key={flag}
          className="rounded-md bg-sev-critical-bg px-2.5 py-0.5 font-mono text-xs text-sev-critical"
        >
          {flag}
        </li>
      ))}
    </ul>
  );
}

function Group({
  title,
  count,
  children,
}: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-muted">
        {title} <span className="normal-case">({count})</span>
      </h4>
      {children}
    </div>
  );
}

const ROW = "grid gap-3 border-t border-line py-1.5 font-mono text-xs";

export function SensorReport({ block }: { block: SensorBlock }) {
  return (
    <div>
      {block.label ? <p className="mb-2 font-mono text-sm">{block.label}</p> : null}
      <Alarms block={block} />

      <Group title="egress" count={block.egress.length}>
        <VirtualRows items={block.egress}>
          {(entry) => (
            <div
              key={`${entry.host}:${entry.port ?? ""}`}
              className={`${ROW} grid-cols-[1fr_5rem_5rem]`}
            >
              <span className={entry.known === false ? "text-sev-critical" : ""}>
                {entry.host}
                {entry.port ? `:${entry.port}` : ""}
              </span>
              <span className="text-fg-muted">{bytes(entry.bytes)}</span>
              <span className={entry.known === false ? "text-sev-critical" : "text-fg-muted"}>
                {entry.known === false ? "unknown" : entry.known === true ? "known" : ""}
              </span>
            </div>
          )}
        </VirtualRows>
      </Group>

      <Group title="files read" count={block.files_read.length}>
        <VirtualRows items={block.files_read}>
          {(entry) => (
            <div key={entry.path} className={`${ROW} grid-cols-[1fr_6rem]`}>
              <span className={entry.sensitive ? "text-sev-critical" : ""}>{entry.path}</span>
              <span className="text-sev-critical">{entry.sensitive ? "sensitive" : ""}</span>
            </div>
          )}
        </VirtualRows>
      </Group>

      <Group title="filesystem changes" count={block.fs_changes.length}>
        <VirtualRows items={block.fs_changes}>
          {(entry) => (
            <div key={entry.path} className={`${ROW} grid-cols-[1fr_5rem_6rem]`}>
              <span className={entry.sensitive ? "text-sev-critical" : ""}>{entry.path}</span>
              <span className="text-fg-muted">{entry.type ?? ""}</span>
              <span className={entry.in_workspace === false ? "text-sev-high" : "text-fg-muted"}>
                {entry.in_workspace === false ? "outside workspace" : ""}
              </span>
            </div>
          )}
        </VirtualRows>
      </Group>

      <Group title="subprocesses" count={block.subprocesses.length}>
        <VirtualRows items={block.subprocesses} estimateSize={26}>
          {(entry, index) => (
            <div key={`${index}-${entry.argv[0]}`} className={`${ROW} grid-cols-[1fr_4rem]`}>
              <span className="truncate">{entry.argv.join(" ")}</span>
              <span className={entry.exit ? "text-sev-high" : "text-fg-muted"}>
                {entry.exit === undefined ? "" : `exit ${entry.exit}`}
              </span>
            </div>
          )}
        </VirtualRows>
      </Group>
    </div>
  );
}
