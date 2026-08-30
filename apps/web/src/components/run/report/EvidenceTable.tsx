"use client";

import type { GroupState } from "@/lib/report/coverage";
import type { ReactNode } from "react";
import { VirtualRows } from "./VirtualRows";

/**
 * One table of sandbox evidence: a heading, a count, named columns, and an
 * answer even when there is nothing in it.
 *
 * Two things went wrong in the version this replaces. The columns had no
 * headers, so `185.220.101.4:443 | 3.1 KB | unknown` asked the reader to guess
 * which figure was bytes and what `unknown` was unknown about. And a group with
 * no rows returned null, so a check that ran cleanly expanded into empty space
 * — the reader had to know that meant clean.
 *
 * The grid template arrives once, as `cols`, and is used by the header row and
 * by every data row, so the two cannot drift. Before this it was restated in
 * each caller and there was no header to drift from.
 */
export function EvidenceTable<T>({
  title,
  items,
  cols,
  heads,
  state,
  detail,
  estimateSize,
  cut,
  note,
  children,
}: {
  title: string;
  items: T[];
  /** The grid template, shared by the header and the rows. */
  cols: string;
  /**
   * One per column, in order. `className` carries whatever the matching cell
   * carries — a column dropped below `sm` has to be dropped from the header
   * too, or the header wraps onto a row of its own on a phone.
   */
  heads: { label: string; className?: string }[];
  state: GroupState;
  /** What the sandbox said about the sensor behind this table, when it was off. */
  detail?: string;
  estimateSize?: number;
  cut?: boolean;
  note?: string;
  children: (item: T, index: number) => ReactNode;
}) {
  // Nothing observed and nothing claimed: a report that never said whether the
  // sensor was watching cannot be made to say "none", so this stays absent, as
  // it always has. A cut list or a note is still worth a table — "0 of them,
  // and the list was truncated" is a different statement from "0 of them".
  if (items.length === 0 && state === "unknown" && !cut && !note) return null;

  return (
    // Its own measure, narrower than the page column. A table set to the full
    // width put seven hundred pixels of nothing between a host and its byte
    // count, and a reader had to track across it row by row.
    <div className="mt-5 max-w-3xl">
      {/* Sentence case, in the reading size, with the count beside the word and
          not at the far end of a very wide column. It was an uppercase,
          wide-tracked micro-label, which made four groups of evidence look like
          chrome. */}
      <h4 className="flex items-baseline gap-2 border-b border-line pb-1 text-sm">
        {title}
        <span className="font-mono text-xs text-fg-muted">
          {state === "blind" ? "not measured" : items.length}
        </span>
      </h4>

      {cut ? <Note>the list below was cut at its cap</Note> : null}
      {note ? <Note>{note}</Note> : null}

      {state === "blind" ? (
        <p className="py-1.5 font-mono text-xs text-sev-high">
          The sensor behind this table was not running
          {detail ? ` — ${detail}` : ""}. What it would have seen is missing from the report, not
          missing from the run.
        </p>
      ) : items.length === 0 ? (
        <p className="py-1.5 font-mono text-xs text-fg-muted">none</p>
      ) : (
        <>
          {/* The first column is the subject and runs long; every column after
              it is fixed-width and reads down its right edge, which is what
              makes two byte counts comparable at a glance. */}
          <div className={`grid ${cols} gap-3 py-1 font-mono text-xs text-fg-muted`}>
            {heads.map((head, index) => (
              <span
                key={head.label}
                className={`${index > 0 ? "text-right" : ""} ${head.className ?? ""}`}
              >
                {head.label}
              </span>
            ))}
          </div>
          <VirtualRows items={items} estimateSize={estimateSize}>
            {children}
          </VirtualRows>
        </>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="py-1 font-mono text-xs text-sev-high">{children}</p>;
}

/** A row of one evidence table. The template is the table's, never its own. */
export function Row({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div className={`grid ${cols} gap-3 border-t border-line py-1.5 font-mono text-xs`}>
      {children}
    </div>
  );
}

/**
 * A cell with nothing in it, said rather than left blank.
 *
 * `known === undefined`, `exit === undefined` and a file that is not sensitive
 * all rendered as an empty cell: three different facts wearing one appearance,
 * in a table an operator reads before blocking a merge.
 */
export function Blank() {
  return <span className="text-fg-muted">—</span>;
}
