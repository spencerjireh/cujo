"use client";

import { type SensorBlock, alarms } from "@/lib/api/report";
import { bytes, describeExit } from "@/lib/format";
import { coverageLine, flaggedTables, groupState, sensorDetail } from "@/lib/report/coverage";
import { isArtifact, isSensitive, relativize } from "@/lib/report/paths";
import { useMemo, useState } from "react";
import { Blank, EvidenceTable, Row } from "./EvidenceTable";

/**
 * The forensic view. This is the thing an operator reads before blocking a
 * merge, so it is ordered the way that reading goes: what tripped, whether
 * anybody was watching while it did, then the evidence itself, column by named
 * column. Every field is optional in the contract, so nothing here assumes a
 * value is present.
 */

/**
 * What tripped, worst first.
 *
 * Bars rather than the rounded pills this replaces, on the same grammar as a
 * row of `FindingsList`: a severity rule on the left, the fact, and the word
 * for how bad it is. The pills were also all critical-red, including the one
 * flag no hard rule reads — see `alarms` in `lib/api/report.ts`.
 */
const TONE: Record<string, string> = {
  critical: "border-sev-critical bg-sev-critical-bg text-sev-critical",
  warn: "border-sev-high bg-sev-high-bg text-sev-high",
};

function Alarms({ block, check }: { block: SensorBlock; check: string }) {
  const flags = alarms(block, check);
  if (flags.length === 0) return null;
  return (
    <ul className="mt-2 flex max-w-3xl flex-col gap-px">
      {flags.map((flag) => (
        <li
          key={flag.text}
          className={`flex items-baseline justify-between gap-3 border-l-2 px-2 py-1 font-mono text-xs ${TONE[flag.severity]}`}
        >
          <span>{flag.text}</span>
          <span className="shrink-0 opacity-70">{flag.severity}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The two caps with no table of their own. `stdout_tail` and `stderr_tail` are
 * not rendered by this component at all — they are read in the raw view — so
 * without this line the fact that they were cut would be parsed and then shown
 * nowhere, which is the failure this whole block exists to stop.
 */
function CutOutput({ block }: { block: SensorBlock }) {
  const cut = [
    block.truncated?.stdout_tail ? "stdout" : null,
    block.truncated?.stderr_tail ? "stderr" : null,
  ].filter(Boolean);
  return (
    <>
      {cut.length > 0 ? (
        <p className="mt-2 font-mono text-xs text-sev-high">
          {cut.join(" and ")} was cut at the tail limit; the raw report below holds what survived
        </p>
      ) : null}
      {block.truncated?.sensor_logs ? (
        <p className="mt-2 font-mono text-xs text-sev-high">
          some sensor log lines could not be decoded
        </p>
      ) : null}
    </>
  );
}

/** Bytes out, or the count of connections the proxy refused. */
function Sent({ bytesOut, errors }: { bytesOut?: number; errors?: number }) {
  if (!bytesOut && errors) {
    // A row that carried nothing because the proxy refused it looked identical
    // to a connection that simply moved no data. It is the opposite of nothing
    // happening: it is the sandbox holding the line.
    return (
      <span className="text-right text-sev-high">
        {errors === 1 ? "refused" : `refused ×${errors}`}
      </span>
    );
  }
  return <span className="text-right text-fg-muted">{bytes(bytesOut)}</span>;
}

function CommandHeader({ block }: { block: SensorBlock }) {
  if (!block.command) return null;
  const { argv, exit, duration_s } = block.command;
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <code className="truncate font-mono text-xs">{argv.join(" ")}</code>
      <span className="flex gap-3 font-mono text-xs text-fg-muted">
        {exit !== null ? (
          <span className={exit !== 0 ? "text-sev-high" : ""}>{describeExit(exit)}</span>
        ) : null}
        {duration_s !== null ? <span>{duration_s}s</span> : null}
      </span>
    </div>
  );
}

/** One row of a path table: the entry, and its path with the shared base off. */
interface PathRow<T> {
  entry: T;
  rel: string;
}

/**
 * The rows of a table of paths, read the way a PR author reads them.
 *
 * The base every path shares is taken off and said once above the table.
 * Bytecode and tool caches are the bulk of most lists and never the reason a
 * row is worth reading, so they are kept out of the rows and behind one
 * trailing count until asked for. The toggle is local: it is a reading aid,
 * not a fact about the run, so nothing else needs to know.
 */
function usePathRows<T extends { path: string }>(entries: T[]) {
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const folded = useMemo(() => {
    const { base, rel } = relativize(entries.map((entry) => entry.path));
    const rows: PathRow<T>[] = [];
    const artifacts: PathRow<T>[] = [];
    entries.forEach((entry, i) => {
      (isArtifact(entry.path) ? artifacts : rows).push({ entry, rel: rel[i] ?? entry.path });
    });
    return { base, rows, artifacts };
  }, [entries]);
  return {
    base: folded.base,
    items: artifactsOpen ? [...folded.rows, ...folded.artifacts] : folded.rows,
    artifacts: folded.artifacts.length,
    artifactsOpen,
    toggleArtifacts: () => setArtifactsOpen((open) => !open),
  };
}

/**
 * The trailing row that stands for the folded artifacts. A real button, so it
 * is in the Tab order and answers Enter and Space like the table headings do.
 */
function ArtifactsRow({
  cols,
  count,
  open,
  onToggle,
}: {
  cols: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  return (
    <Row cols={cols}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="min-w-0 text-left text-fg-muted underline decoration-line underline-offset-2 hover:text-fg"
      >
        {open ? "hide " : ""}
        {count} build {count === 1 ? "artifact" : "artifacts"}
      </button>
    </Row>
  );
}

/** Red when the report said so, or when the sandbox's own list would have. */
function pathTone(path: string, flagged?: boolean): string {
  return flagged || isSensitive(path) ? "text-sev-high" : "";
}

/** Said where the script is, because a script that was cut is not a short script. */
function Cut({ cut, label = "truncated" }: { cut?: boolean; label?: string }) {
  if (!cut) return null;
  return <span className="ml-2 normal-case text-sev-high">{label}</span>;
}

function ScriptContent({ block }: { block: SensorBlock }) {
  const content = block.command?.script_content;
  if (content === null || content === undefined) return null;
  const cut = block.truncated?.script_content;
  return (
    <details className="mb-3">
      <summary className="cursor-pointer font-mono text-xs text-fg-muted">
        captured script{cut ? <Cut cut label="truncated" /> : null}
      </summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-canvas-inset p-3 font-mono text-xs leading-relaxed">
        {content}
      </pre>
    </details>
  );
}

// Narrow first, so a long path keeps a column of its own at 380 px, and the
// meta columns widen once there is room for them.
const EGRESS = "grid-cols-[1fr_4.5rem] sm:grid-cols-[1fr_6rem_6rem]";
const FILES = "grid-cols-[1fr_5.5rem]";
const CHANGES = "grid-cols-[1fr_5rem] sm:grid-cols-[1fr_5rem_9rem]";
// Wide enough on the right for `exit -15 (SIGTERM, expected)`, the longest
// thing `describeExit` says; on a phone the cell wraps instead.
const PROCS = "grid-cols-[1fr_5rem] sm:grid-cols-[1fr_12rem]";

// `wrap-anywhere` and not `break-all`: a path with no spaces in it still has to
// break somewhere, but a word beside it must not, and `break-all` was splitting
// "unknown" across two lines to save four pixels.
const PATH = "min-w-0 wrap-anywhere";

export function SensorReport({
  block,
  check,
  index = 0,
  total = 1,
}: {
  block: SensorBlock;
  /** The check this block belongs to; one alarm's severity depends on it. */
  check: string;
  index?: number;
  total?: number;
}) {
  const coverage = coverageLine(block);
  // Which tables this block's own flags point at. Those open with the card;
  // the rest are a heading and a count until somebody asks.
  const flagged = flaggedTables(block);
  const reads = usePathRows(block.files_read);
  const changes = usePathRows(block.fs_changes);
  return (
    // From the second block on, a rule and a caption. A detonation report is a
    // roll-up plus one block per dependency, and they used to stack with
    // nothing between them but a small mono line.
    <div className={index > 0 ? "mt-6 border-t border-line pt-5" : ""}>
      {block.label || total > 1 ? (
        <div className="flex max-w-3xl items-baseline justify-between gap-3">
          <p className="font-mono text-sm">{block.label ?? "all runs"}</p>
          {total > 1 ? (
            <p className="shrink-0 font-mono text-xs text-fg-muted">
              {index + 1} of {total}
            </p>
          ) : null}
        </div>
      ) : null}

      <CommandHeader block={block} />
      <Alarms block={block} check={check} />
      {coverage ? <p className="mt-2 max-w-[68ch] text-sm">{coverage}</p> : null}
      <CutOutput block={block} />
      <ScriptContent block={block} />

      <EvidenceTable
        title="Egress"
        items={block.egress}
        cols={EGRESS}
        heads={[
          { label: "host" },
          { label: "bytes out" },
          { label: "known?", className: "hidden sm:block" },
        ]}
        state={groupState(block, "proxy")}
        detail={sensorDetail(block, "proxy")}
        defaultOpen={flagged.has("egress")}
      >
        {(entry) => (
          <Row key={`${entry.host}:${entry.port ?? ""}`} cols={EGRESS}>
            <span className={`${PATH} ${entry.known === false ? "text-sev-critical" : ""}`}>
              {entry.host}
              {entry.port ? `:${entry.port}` : ""}
              {/* The column that carries this is dropped on a phone, and a red
                  host on its own is a fact told in colour alone. */}
              {entry.known === false ? <span className="sm:hidden"> · unknown</span> : null}
            </span>
            <Sent bytesOut={entry.bytes} errors={entry.errors} />
            <span
              className={`hidden text-right sm:block ${
                entry.known === false ? "text-sev-critical" : "text-fg-muted"
              }`}
            >
              {entry.known === false ? "unknown" : entry.known === true ? "known" : <Blank />}
            </span>
          </Row>
        )}
      </EvidenceTable>

      <EvidenceTable
        title="Files read"
        items={reads.items}
        count={block.files_read.length}
        base={reads.base}
        cols={FILES}
        heads={[{ label: "path" }, { label: "sensitive?" }]}
        state={groupState(block, "audit")}
        detail={sensorDetail(block, "audit")}
        cut={block.truncated?.files_read}
        defaultOpen={flagged.has("files_read")}
        footer={
          <ArtifactsRow
            cols={FILES}
            count={reads.artifacts}
            open={reads.artifactsOpen}
            onToggle={reads.toggleArtifacts}
          />
        }
      >
        {({ entry, rel }) => (
          <Row key={entry.path} cols={FILES}>
            <span className={`${PATH} ${pathTone(entry.path, entry.sensitive)}`}>{rel}</span>
            <span className="text-right text-sev-critical">
              {entry.sensitive ? "sensitive" : <Blank />}
            </span>
          </Row>
        )}
      </EvidenceTable>

      <EvidenceTable
        title="Filesystem changes"
        items={changes.items}
        count={block.fs_changes.length}
        base={changes.base}
        cols={CHANGES}
        heads={[
          { label: "path" },
          { label: "change" },
          { label: "where", className: "hidden sm:block" },
        ]}
        state={groupState(block, "fs_diff")}
        detail={sensorDetail(block, "fs_diff")}
        defaultOpen={flagged.has("fs_changes")}
        cut={block.truncated?.snapshot}
        note={
          block.truncated?.hashes ? "some files compared by timestamp and size only" : undefined
        }
        footer={
          <ArtifactsRow
            cols={CHANGES}
            count={changes.artifacts}
            open={changes.artifactsOpen}
            onToggle={changes.toggleArtifacts}
          />
        }
      >
        {({ entry, rel }) => (
          <Row key={entry.path} cols={CHANGES}>
            <span className={`${PATH} ${pathTone(entry.path, entry.sensitive)}`}>
              {rel}
              {entry.in_workspace === false ? (
                <span className="text-sev-high sm:hidden"> · outside workspace</span>
              ) : null}
            </span>
            <span className="text-right text-fg-muted">{entry.type ?? <Blank />}</span>
            <span
              className={`hidden text-right sm:block ${
                entry.in_workspace === false ? "text-sev-high" : "text-fg-muted"
              }`}
            >
              {entry.in_workspace === false ? (
                "outside workspace"
              ) : entry.in_workspace === true ? (
                "in workspace"
              ) : (
                <Blank />
              )}
            </span>
          </Row>
        )}
      </EvidenceTable>

      <EvidenceTable
        title="Subprocesses"
        items={block.subprocesses}
        cols={PROCS}
        heads={[{ label: "command" }, { label: "exit" }]}
        state={groupState(block, "audit")}
        detail={sensorDetail(block, "audit")}
        estimateSize={26}
        defaultOpen={flagged.has("subprocesses")}
      >
        {(entry, i) => (
          <Row key={`${i}-${entry.argv[0]}`} cols={PROCS}>
            {/* Wrapped, not clipped. This is the one cell where the tail is the
                answer: `pip install` says nothing, and what came after it is
                the whole reason the row is here. */}
            <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">
              {entry.argv.join(" ")}
            </span>
            <span className={`text-right ${entry.exit ? "text-sev-high" : "text-fg-muted"}`}>
              {entry.exit === undefined ? <Blank /> : describeExit(entry.exit)}
            </span>
          </Row>
        )}
      </EvidenceTable>
    </div>
  );
}
