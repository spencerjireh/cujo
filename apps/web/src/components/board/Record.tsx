"use client";

import { RelativeTime } from "@/components/RelativeTime";
import { SensorStrip } from "@/components/board/SensorStrip";
import { type RunStatus, type RunSummary, isLive } from "@/lib/api/types";
import { setFocusedRun, useFocusedRun } from "@/lib/board/store";
import { STATUS_LABELS, TONE_TEXT, statusTone } from "@/lib/board/tone";
import { duration, shortSha } from "@/lib/format";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * The record: every run Cujo has executed, as a log.
 *
 * This is the rebuilt `RunsTable`. What it keeps is deliberate — TanStack Table
 * v9, the filter pills with their counts, sortable headers carrying `aria-sort`,
 * and a link per row — because those are the parts a reader uses and none of
 * them was the problem. What changed is what a row says: the single status pill
 * became a four-segment sensor strip plus the verdict word, and a duration
 * column was added, so a row carries the evidence and not only the conclusion.
 *
 * Hovering a row lights its specimen in the chamber, and hovering a specimen
 * lights the row. That is the whole reason the two are on one page: the record
 * is the index, and the chamber is the shape of it.
 */

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, RunSummary>();

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
  const data = useMemo(() => runs.filter((run) => matches(filter, run.status)), [runs, filter]);

  const table = useTable({
    features,
    columns,
    data,
    // The API already returns newest first; this makes the order changeable.
    initialState: { sorting: [{ id: "updated_at", desc: true }] },
  });

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
        <p className="text-sm text-fg-muted">
          {runs.length === 0
            ? "No runs yet. Open a pull request on a repository where Cujo is installed and one appears here."
            : "No runs match this filter."}
        </p>
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
                            className="transition-colors hover:text-fg"
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
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onPointerEnter={() => setFocusedRun(row.original.id)}
                  onPointerLeave={() => setFocusedRun(null)}
                  className={`group border-line border-b transition-colors last:border-0 ${
                    focused === row.original.id ? "bg-bg-raised" : ""
                  }`}
                >
                  {row.getAllCells().map((cell, index) => (
                    <td key={cell.id} className="py-3 pr-4">
                      {index === 0 ? (
                        <Link
                          href={`/runs/${row.original.id}`}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
