"use client";

import { type SensorBlock, alarms } from "@/lib/api/report";
import { bytes } from "@/lib/format";
import { VirtualRows } from "./VirtualRows";

/**
 * The forensic view. This is the thing an operator reads before blocking a
 * merge, so the flags that decide the outcome sit above the raw evidence rather
 * than inside it. Every field is optional in the contract, so nothing here
 * assumes a value is present.
 *
 * The strip under the alarms answers the question the tables cannot: an empty
 * `egress` means nobody was dialled, or means the proxy was not running. A
 * sensor with no verdict at all — a report written before the block existed —
 * renders as unknown rather than as either answer.
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

const SENSOR_LABELS: Record<string, string> = {
  proxy: "proxy",
  decoy: "decoy watcher",
  audit: "python hook",
  fs_diff: "filesystem",
};

function Sensors({ block }: { block: SensorBlock }) {
  if (!block.sensors) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {Object.entries(block.sensors).map(([name, entry]) => {
        // The state is carried by the word, not by the dot: this palette has no
        // green, and a colour nobody can name is not a reading.
        const state = entry.armed === false ? "off" : entry.armed === true ? "" : "unknown";
        const down = entry.armed === false;
        return (
          <li
            key={name}
            className={`font-mono text-xs ${down ? "text-sev-high" : "text-fg-muted"}`}
          >
            <span
              aria-hidden
              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                down ? "bg-sev-high" : "bg-line"
              }`}
            />
            {SENSOR_LABELS[name] ?? name}
            {state ? ` ${state}` : ""}
            {entry.detail ? ` — ${entry.detail}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

/** Said where the list is, because a list that was cut is not a short list. */
function Cut({ cut }: { cut?: boolean }) {
  if (!cut) return null;
  return <span className="ml-2 normal-case text-sev-high">truncated</span>;
}

/**
 * The two caps with no table of their own. `stdout_tail` and `stderr_tail` are
 * not rendered by this component at all -- they are read in the raw view -- so
 * without this line the fact that they were cut would be parsed and then shown
 * nowhere, which is the failure this whole block exists to stop.
 */
function CutOutput({ block }: { block: SensorBlock }) {
  const cut = [
    block.truncated?.stdout_tail ? "stdout" : null,
    block.truncated?.stderr_tail ? "stderr" : null,
  ].filter(Boolean);
  if (cut.length === 0) return null;
  return (
    <p className="mb-3 font-mono text-xs text-sev-high">
      {cut.join(" and ")} was cut at the tail limit; the raw report below holds what survived
    </p>
  );
}

function Group({
  title,
  count,
  cut,
  children,
}: { title: string; count: number; cut?: boolean; children: React.ReactNode }) {
  // A group that was cut still renders when it is empty: "0 of them, and the
  // list was truncated" is a different statement from "0 of them".
  if (count === 0 && !cut) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-muted">
        {title} <span className="normal-case">({count})</span>
        <Cut cut={cut} />
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
      <Sensors block={block} />
      <CutOutput block={block} />

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

      <Group title="files read" count={block.files_read.length} cut={block.truncated?.files_read}>
        <VirtualRows items={block.files_read}>
          {(entry) => (
            <div key={entry.path} className={`${ROW} grid-cols-[1fr_6rem]`}>
              <span className={entry.sensitive ? "text-sev-critical" : ""}>{entry.path}</span>
              <span className="text-sev-critical">{entry.sensitive ? "sensitive" : ""}</span>
            </div>
          )}
        </VirtualRows>
      </Group>

      <Group
        title="filesystem changes"
        count={block.fs_changes.length}
        cut={block.truncated?.snapshot}
      >
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
