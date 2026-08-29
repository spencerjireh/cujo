"use client";

import { RelativeTime } from "@/components/RelativeTime";
import { SensorStrip } from "@/components/board/SensorStrip";
import { type RunStatus, type RunSummary, isLive } from "@/lib/api/types";
import { clearSelectedRun, setFocusedRun, useFocusedRun, useSelectedRun } from "@/lib/board/store";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
  STATUS_LABELS,
  TONE_FILL,
  TONE_TEXT,
  findingTotal,
  findingWeight,
  statusTone,
} from "@/lib/board/tone";
import { duration, shortSha } from "@/lib/format";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The record: every run Cujo has executed, as a log.
 *
 * What a row says is the evidence and not only the conclusion: a four-segment
 * sensor strip for the checks, a severity bar for what they found, a duration,
 * and then the verdict.
 *
 * Hovering a row lights its specimen in the chamber, and hovering a specimen
 * lights the row. Clicking a specimen scrolls the record here and marks the
 * row. That is the whole reason the two are on one page: the record is the
 * index, and the chamber is the shape of it.
 */

/**
 * Rows the table keeps space for, real or not.
 *
 * A board with two runs used to put the log hard against whatever followed it,
 * which read as a page that had run out rather than a record that is young.
 * The extra rows are drawn empty and hidden from assistive technology — they
 * are spacing with the table's own rhythm, and they claim nothing.
 */
const MIN_ROWS = 5;

/**
 * Stable keys for the ruled lines below a short record. Named rather than
 * indexed because they are decoration and never reorder, and an index key on a
 * list React might reconcile is the habit worth not having.
 */
const GHOST_ROWS = ["ghost-a", "ghost-b", "ghost-c", "ghost-d", "ghost-e"] as const;

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, RunSummary>();

/** The severity bar on a row: the same three tones the rack and the chamber use. */
function FindingsCell({ run }: { run: RunSummary }) {
  if (!run.digest) return <span className="font-mono text-xs text-fg-muted">—</span>;
  const counts = run.digest.findings;
  const total = findingTotal(counts);
  if (total === 0) return <span className="font-mono text-xs text-fg-muted">none</span>;
  const spoken = SEVERITY_ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  return (
    <span className="flex items-center gap-2" title={spoken}>
      <span className="sr-only">{spoken}</span>
      <span className="flex h-1.5 w-16 gap-px" aria-hidden="true">
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
      <span className="font-mono text-xs text-fg-muted" aria-hidden="true">
        {total}
      </span>
    </span>
  );
}

const columns = helper.columns([
  helper.accessor("repo", {
    header: "Pull request",
    // The identifier stays monospaced and the title trails it in prose, so a
    // row still scans as a list of pull requests rather than of sentences.
    cell: (cell) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono">
          {cell.row.original.repo} #{cell.row.original.pr_number}
        </span>
        {cell.row.original.pr_title ? (
          <span className="truncate text-fg-muted">{cell.row.original.pr_title}</span>
        ) : null}
      </span>
    ),
  }),
  helper.accessor("head_sha", {
    header: "Head",
    cell: (cell) => <span className="font-mono text-fg-muted">{shortSha(cell.getValue())}</span>,
  }),
  helper.display({
    id: "checks",
    header: "Checks",
    cell: (cell) => <SensorStrip run={cell.row.original} />,
  }),
  // Sorted by rank and not by count, so one critical outranks nine infos. A
  // run with no digest weighs nothing, which puts it below a clean run rather
  // than above one — it found nothing because nothing looked.
  helper.accessor((run) => findingWeight(run.digest?.findings), {
    id: "findings",
    header: "Found",
    cell: (cell) => <FindingsCell run={cell.row.original} />,
  }),
  helper.accessor("status", {
    header: "Verdict",
    cell: (cell) => {
      const status = cell.getValue();
      return (
        <span
          className={`flex items-center gap-1.5 font-mono text-xs ${TONE_TEXT[statusTone(status)]}`}
        >
          {status === "running" ? (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
              aria-hidden="true"
            />
          ) : null}
          {STATUS_LABELS[status]}
        </span>
      );
    },
  }),
  helper.accessor((run) => run.digest?.durationMs ?? null, {
    id: "duration",
    header: "Took",
    // An em dash and not "0s": a run still going, or one folded before the
    // stamps existed, measured nothing.
    cell: (cell) => {
      const ms = cell.getValue();
      return (
        <span className="font-mono text-xs text-fg-muted">
          {ms === null
            ? "—"
            : (duration(new Date(0).toISOString(), new Date(ms).toISOString()) ?? "—")}
        </span>
      );
    },
  }),
  helper.accessor("updated_at", {
    header: "Updated",
    cell: (cell) => (
      <span className="text-fg-muted">
        <RelativeTime iso={cell.getValue()} />
      </span>
    ),
  }),
]);

type Filter = "all" | "live" | "blocked_pending";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "blocked_pending", label: "Awaiting approval" },
];

function matches(filter: Filter, status: RunStatus): boolean {
  if (filter === "all") return true;
  if (filter === "live") return isLive(status);
  return status === filter;
}

export function Record({ runs }: { runs: RunSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const focused = useFocusedRun();
  const selected = useSelectedRun();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const data = useMemo(() => runs.filter((run) => matches(filter, run.status)), [runs, filter]);

  /**
   * A specimen was clicked. Bring its row into view and put the keyboard on it.
   *
   * Moving focus is the part that matters: the canvas is `aria-hidden`, so a
   * scroll alone is a change nobody using a screen reader or a keyboard is
   * told about. Landing on the row's link announces the run and leaves the
   * next Tab where the reader expects it.
   *
   * A filter that hides the picked run is cleared rather than obeyed — the
   * click said which run, and answering with "no runs match this filter" is
   * the wrong end of the request.
   */
  useEffect(() => {
    if (!selected) return;
    if (!runs.some((run) => run.id === selected)) return;
    if (!data.some((run) => run.id === selected)) {
      setFilter("all");
      return;
    }
    const anchor = rowRefs.current.get(selected);
    if (!anchor) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    anchor.focus({ preventScroll: true });
  }, [selected, data, runs]);

  /** Escape puts the record back, which is the only way to unpick from here. */
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelectedRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const table = useTable({
    features,
    columns,
    data,
    // The API already returns newest first; this makes the order changeable.
    initialState: { sorting: [{ id: "updated_at", desc: true }] },
  });

  const rows = table.getRowModel().rows;
  const ghosts = Math.max(0, MIN_ROWS - rows.length);

  return (
    <section aria-label="Every run" className="px-4 py-10 md:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg">The record</h2>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const count = runs.filter((run) => matches(option.id, run.status)).length;
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-pressed={active}
                className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors ${
                  active
                    ? "border-accent text-accent"
                    : "border-line text-fg-muted hover:border-fg-muted hover:text-fg"
                }`}
              >
                {option.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyRecord filtered={runs.length > 0} onClear={() => setFilter("all")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    // `checks` is a display column with no value to order by,
                    // so it gets no button. A focusable control that promises
                    // sorting and does nothing is worse than a plain label —
                    // and `aria-sort` belongs only on a column that can sort.
                    const sortable = header.column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        // The arrow glyph is decoration; this is the state a
                        // screen reader reads.
                        aria-sort={
                          !sortable
                            ? undefined
                            : header.column.getIsSorted() === "asc"
                              ? "ascending"
                              : header.column.getIsSorted() === "desc"
                                ? "descending"
                                : "none"
                        }
                        className="border-line border-b py-2 pr-4 text-left font-mono text-xs font-medium uppercase tracking-wider text-fg-muted"
                      >
                        {header.isPlaceholder ? null : sortable ? (
                          <button
                            type="button"
                            onClick={() => header.column.toggleSorting()}
                            // `uppercase` restated on the button: the header
                            // cell already sets it, and a button does not take
                            // it from the cell, so the one column with no sort
                            // control was the only header in caps.
                            className="uppercase transition-colors hover:text-fg"
                          >
                            <table.FlexRender header={header} />
                            {header.column.getIsSorted() === "asc"
                              ? " ↑"
                              : header.column.getIsSorted() === "desc"
                                ? " ↓"
                                : ""}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selected === row.original.id;
                return (
                  <tr
                    key={row.id}
                    onPointerEnter={() => setFocusedRun(row.original.id)}
                    onPointerLeave={() => setFocusedRun(null)}
                    className={`group border-line border-b transition-colors last:border-0 ${
                      isSelected || focused === row.original.id ? "bg-bg-raised" : ""
                    }`}
                  >
                    {row.getAllCells().map((cell, index) => (
                      <td
                        key={cell.id}
                        // The accent rule is the picked run, and it is on a
                        // border that is always there so nothing shifts by two
                        // pixels when one is picked.
                        className={`py-3 pr-4 ${
                          index === 0
                            ? `border-l-2 pl-2 ${isSelected ? "border-accent" : "border-transparent"}`
                            : ""
                        }`}
                      >
                        {index === 0 ? (
                          <Link
                            href={`/runs/${row.original.id}`}
                            ref={(node) => {
                              if (node) rowRefs.current.set(row.original.id, node);
                              else rowRefs.current.delete(row.original.id);
                            }}
                            // Focus reaches the chamber too, so a keyboard walk
                            // down the record moves the highlight with it.
                            onFocus={() => setFocusedRun(row.original.id)}
                            onBlur={() => setFocusedRun(null)}
                            className="text-fg no-underline group-hover:text-accent"
                          >
                            <table.FlexRender cell={cell} />
                          </Link>
                        ) : (
                          <table.FlexRender cell={cell} />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Ruled lines continuing past the last row, outside the table.
              Spacing with the table's own rhythm, so a young record looks
              young rather than cramped — and not empty `<tr>` elements, which
              would put rows in the table that hold nothing and would be
              announced to anyone walking it. */}
          {ghosts > 0 ? (
            <div aria-hidden="true">
              {GHOST_ROWS.slice(0, ghosts).map((id) => (
                <div key={id} className="h-[2.6rem] border-line border-b" />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * The two empty records are different states and say different things. One is
 * a board waiting for its first pull request; the other is a filter the reader
 * applied and can undo, so it offers the undo.
 */
function EmptyRecord({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex min-h-[14rem] flex-col items-start justify-center gap-3 border border-line px-6 py-10">
      {filtered ? (
        <>
          <p className="font-mono text-sm text-fg-muted">No run matches this filter.</p>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
          >
            Show every run
          </button>
        </>
      ) : (
        <>
          <p className="font-mono text-sm text-fg">The record is empty.</p>
          <p className="max-w-[52ch] font-mono text-sm leading-relaxed text-fg-muted">
            Install Cujo on a repository and open a pull request. The next push clones it into a
            disposable sandbox, runs it, and the run lands here.
          </p>
        </>
      )}
    </div>
  );
}
