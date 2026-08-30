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
  compareFindings,
  findingTotal,
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
 * The record has a floor and a ceiling, and both are measured in its own rows.
 *
 * A board with two runs used to put the log hard against whatever followed it,
 * and a board with sixty pushed the key off the bottom of the page. Neither is
 * a different component: it is one field of a fixed length, like a strip of
 * chart paper, and the number of readings on it does not change how much panel
 * it takes up. Empty, sparse and full all occupy the same band.
 *
 * `ROW_REM` is the height of one row — `py-3` on a line of `text-sm`, which is
 * what the ruled lines below a short record have always matched.
 */
const ROW_REM = 2.6;
const MIN_ROWS = 5;
const MAX_ROWS = 12;
/** The header scrolls with nothing, so it is inside the cap and counted in it. */
const HEAD_REM = 1.9;

/**
 * The ceiling, cut at half a row.
 *
 * A whole number of rows would sit flush against the bottom edge and read as
 * the end of the record; a row sliced through the middle is the scroll
 * affordance, and it costs nothing to draw. `70vh` keeps the cap from
 * overrunning a short viewport, where the mid-row cut lands wherever it lands.
 */
const MAX_HEIGHT = `min(${HEAD_REM + (MAX_ROWS + 0.5) * ROW_REM}rem, 70vh)`;

/**
 * Stable keys for the ruled lines below a short record. Named rather than
 * indexed because they are decoration and never reorder, and an index key on a
 * list React might reconcile is the habit worth not having.
 */
const GHOST_ROWS = ["ghost-a", "ghost-b", "ghost-c", "ghost-d", "ghost-e"] as const;

/**
 * The App's public page, which carries the Install button and renders for a
 * reader who is not signed in. `/installations/new` is the more direct target
 * and bounces an anonymous reader through a login first, which is the wrong
 * first thing to show someone who has not decided yet.
 */
const INSTALL_URL = "https://github.com/apps/cujo-guard";

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
  // Ordered rank by rank rather than by a folded weight, so no number of a
  // lower severity can climb past a higher one. The accessor exists only to
  // give the column a value; `compareFindings` is what decides the order.
  helper.accessor((run) => run.digest?.findings ?? null, {
    id: "findings",
    header: "Found",
    sortFn: (rowA, rowB) =>
      compareFindings(rowA.original.digest?.findings, rowB.original.digest?.findings),
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

/**
 * `empty` is what the record says when this filter selects nothing, and it
 * names the filter rather than restating it. "No run matches this filter" makes
 * a reader look back up at the chips to work out which one; the sentence they
 * want is the one that answers the question they asked.
 */
const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "No runs yet." },
  { id: "live", label: "Live", empty: "Nothing is running." },
  { id: "blocked_pending", label: "Awaiting approval", empty: "No run is waiting on a person." },
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
   *
   * **Once per pick, and no more.** The selection outlives the pointer by
   * design, and `runs` and `data` are new arrays on every poll — five seconds
   * apart while anything is live. Without the guard this effect scrolled and
   * stole focus on that cadence, dragging a reader back to the selected link
   * while they were reading or tabbing somewhere else in the record. The mark
   * on the row stays; only the scroll and the focus are a one-time delivery.
   */
  const delivered = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) {
      delivered.current = null;
      return;
    }
    if (delivered.current === selected) return;
    if (!runs.some((run) => run.id === selected)) return;
    if (!data.some((run) => run.id === selected)) {
      // Not marked delivered: clearing the filter re-renders, and the pass
      // after it is the one that actually scrolls.
      setFilter("all");
      return;
    }
    const anchor = rowRefs.current.get(selected);
    if (!anchor) return;
    delivered.current = selected;
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
  // No ruled lines under an empty record: the empty block draws its own, at
  // the same rhythm and for the whole of the five rows it stands in.
  const ghosts = rows.length === 0 ? 0 : Math.max(0, MIN_ROWS - rows.length);

  /**
   * Whether the scrollport clips anything, on either axis.
   *
   * A tab stop that scrolls nothing is a tab stop nobody wanted, so the region
   * takes its role and its stop only when there is something out of view to
   * reach. But the row count does not decide that. The ceiling is
   * `min(…, 70vh)`, so a short viewport clips well under twelve rows; and this
   * is the same scrollport the seven columns overflow sideways in, which a
   * phone does at any row count at all. Counting rows would have left both of
   * those clipped and unreachable from a keyboard.
   *
   * So it is measured. The observer watches the port for a viewport resize and
   * its children for content that reflows inside it, and the effect re-runs
   * when the rows or the filter change the content outright. A sub-pixel
   * difference is rounding rather than clipped content, hence the 1px floor.
   */
  const scrollport = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows.length` and `filter` are triggers, not inputs — the effect reads neither, and they are in the list precisely so content the observer cannot see change gets re-measured.
  useEffect(() => {
    const node = scrollport.current;
    if (!node) return;
    const measure = () =>
      setClipped(
        node.scrollHeight - node.clientHeight > 1 || node.scrollWidth - node.clientWidth > 1,
      );
    measure();
    // jsdom has no ResizeObserver. The measurement above still runs, so a test
    // that stubs the layout gets the state it set up; nothing else is missed.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, [rows.length, filter]);

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

      {/* One scrollport for both axes and for every state. The record is the
          same object whether it holds nothing or sixty runs, so the floor, the
          ceiling and the column header belong to the field and not to a branch
          inside it. */}
      <div
        ref={scrollport}
        className="overflow-auto"
        style={{ maxHeight: MAX_HEIGHT }}
        // Only a scrollport a keyboard can actually move gets the role and the
        // stop; while nothing is clipped this is a plain wrapper.
        {...(clipped
          ? { tabIndex: 0, role: "region" as const, "aria-label": "The record, scrollable" }
          : {})}
      >
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
                      // Pinned to the top of the scrollport, so a long
                      // record keeps its column names while it moves. The
                      // rule below the header is an inset shadow and not a
                      // border: `border-collapse` hands a collapsed border
                      // to the row, which is not the element that sticks, so
                      // the line would scroll away and leave the header
                      // sitting on the rows.
                      className="sticky top-0 z-10 bg-bg py-2 pr-4 text-left font-mono text-xs font-medium uppercase tracking-wider text-fg-muted shadow-[inset_0_-1px_0_var(--line)]"
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
        {/* Outside the table and not in a cell spanning it. A table cell is as
            wide as the table, and the table is wider than a phone: the copy
            would then need a sideways scroll to be read. A block here takes the
            scrollport's own width instead and wraps inside it, while the header
            above keeps scrolling as the table it belongs to. */}
        {rows.length === 0 ? (
          <EmptyRecord filter={filter} onClear={() => setFilter("all")} />
        ) : null}
        {/* Ruled lines continuing past the last row, outside the table.
            Spacing with the table's own rhythm, so a young record looks young
            rather than cramped — and not empty `<tr>` elements, which would put
            rows in the table that hold nothing and would be announced to
            anyone walking it. */}
        {ghosts > 0 ? (
          <div aria-hidden="true">
            {GHOST_ROWS.slice(0, ghosts).map((id) => (
              <div key={id} className="border-line border-b" style={{ height: `${ROW_REM}rem` }} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * An empty record, drawn inside the record rather than instead of it.
 *
 * The column header stays above this and the field keeps the height five rows
 * would take, so a board reading nothing is an armed instrument and not a page
 * missing its middle — and nothing on the page moves when the first run lands.
 *
 * The two empty states are different and say different things. One is a board
 * waiting for its first pull request, and the only useful thing to hand a
 * reader there is the way to cause one. The other is a filter the reader
 * applied and can undo, so it offers the undo and nothing else: telling
 * somebody to install the App because they clicked "Live" would be answering a
 * question they did not ask.
 */
function EmptyRecord({ filter, onClear }: { filter: Filter; onClear: () => void }) {
  const headline = FILTERS.find((option) => option.id === filter)?.empty ?? "No runs yet.";
  return (
    <div className="relative flex items-center" style={{ minHeight: `${MIN_ROWS * ROW_REM}rem` }}>
      {/* The same ruled lines a short record gets, at the same rhythm, running
          the width of the field. They are what makes this an armed instrument
          and not a blank panel: the reader can see where a reading will land
          before there is one, and nothing moves when the first run arrives. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${ROW_REM}rem - 1px), var(--line) calc(${ROW_REM}rem - 1px), var(--line) ${ROW_REM}rem)`,
        }}
      />
      {/* The copy sits on its own ground, the way a label plate covers the part
          of a chart it annotates — so the rules run past it rather than
          through it, and the type stays on a flat background. `w-fit` is what
          leaves them anything to run across. */}
      <div className="relative flex w-fit flex-col items-start gap-3 bg-bg py-3 pr-10 pl-2">
        <p className="font-mono text-sm text-fg">{headline}</p>
        {filter === "all" ? (
          <>
            <p className="max-w-[56ch] font-mono text-sm leading-relaxed text-fg-muted">
              Install Cujo on a repository and open a pull request. The head is cloned into a
              disposable sandbox, executed, and the run lands here.
            </p>
            {/* The one action on an empty board, so it takes the accent the
                filter chips use for their active state. Amber and not filled
                amber: the brand spends the fill on approving a merge. */}
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-accent px-3 py-1 font-mono text-xs text-accent no-underline transition-colors hover:border-accent-fill hover:bg-accent-fill hover:text-accent-fg"
            >
              Install Cujo
            </a>
          </>
        ) : (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
          >
            Show every run
          </button>
        )}
      </div>
    </div>
  );
}
