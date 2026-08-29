"use client";

import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import { type RunStatus, type RunSummary, isLive } from "@/lib/api/types";
import { shortSha } from "@/lib/format";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";

// v9 registers features explicitly rather than passing row models to the hook.
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, RunSummary>();

const columns = helper.columns([
  helper.accessor("repo", {
    header: "Pull request",
    // The identifier stays monospaced and the title trails it in prose, so a
    // row still scans as a list of pull requests rather than of sentences. A
    // run recorded before titles were stored simply has no trailing half.
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
  helper.accessor("status", {
    header: "Status",
    cell: (cell) => <StatusBadge status={cell.getValue()} />,
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

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const data = useMemo(() => runs.filter((run) => matches(filter, run.status)), [runs, filter]);

  const table = useTable({
    features,
    columns,
    data,
    // The API already returns newest first; this makes the order changeable.
    initialState: { sorting: [{ id: "updated_at", desc: true }] },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
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

      {data.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {runs.length === 0
            ? "No runs yet. Open a pull request on a repository where Cujo is installed and one will appear here."
            : "No runs match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      // The arrow glyph is decoration; this is the state a
                      // screen reader reads.
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                      }
                      className="border-b border-line py-2 pr-4 text-left font-mono text-xs font-medium uppercase tracking-wider text-fg-muted"
                    >
                      {header.isPlaceholder ? null : (
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
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="group border-b border-line last:border-0">
                  {row.getAllCells().map((cell, index) => (
                    <td key={cell.id} className="py-3 pr-4">
                      {index === 0 ? (
                        <Link
                          href={`/runs/${row.original.id}`}
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
    </div>
  );
}
