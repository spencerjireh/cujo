"use client";

import { Chevron } from "@/components/icons/Chevron";
import type { GroupState } from "@/lib/report/coverage";
import * as Collapsible from "@radix-ui/react-collapsible";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
 *
 * The rows collapse, and the heading is the control. A detonation report is a
 * roll-up plus one block per dependency, so a card that opened everything was
 * twelve tables deep and the reader scrolled past eleven of them to reach the
 * one the alarms were about. Closed, the heading still carries the count, which
 * is the part that was worth the scroll. `defaultOpen` is decided by
 * `flaggedTables`, not guessed here: a card opens on the rows that prove what
 * the bars at the top of it say, and stays shut on the rest.
 *
 * A table with no rows is not a control at all, and carries no glyph: a `0` and
 * a `not measured` are facts with nothing behind them, and a disclosure that
 * opens onto a sentence is a disclosure that wasted a click.
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
  defaultOpen = false,
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
  /** Whether this table holds the evidence for something the block flagged. */
  defaultOpen?: boolean;
  children: (item: T, index: number) => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // On the rising edge, the way `CheckReport` opens itself: a check mounts
  // while it is still running and its report arrives later, over the stream,
  // into this same component. Without this the table a watcher most needs open
  // is the one that stays shut. A table the reader closed again stays closed.
  const wasFlagged = useRef(defaultOpen);
  useEffect(() => {
    if (defaultOpen && !wasFlagged.current) setOpen(true);
    wasFlagged.current = defaultOpen;
  }, [defaultOpen]);

  // Nothing observed and nothing claimed: a report that never said whether the
  // sensor was watching cannot be made to show a zero, so this stays absent, as
  // it always has. A cut list or a note is still worth a table — "0 of them,
  // and the list was truncated" is a different statement from "0 of them".
  if (items.length === 0 && state === "unknown" && !cut && !note) return null;

  // A blind table has no rows to show even when the list is not empty: the
  // sensor was off, so what it holds is not what happened.
  const rows = state !== "blind" && items.length > 0;

  return (
    // Its own measure, narrower than the page column. A table set to the full
    // width put seven hundred pixels of nothing between a host and its byte
    // count, and a reader had to track across it row by row.
    <div className="mt-5 max-w-3xl">
      {rows ? (
        <Collapsible.Root open={open} onOpenChange={setOpen}>
          {/* No hover ground and no negative margin: the rule under this
              heading lines up with the rule over every row below it, and four
              of these to a block, three blocks to a card, a band of colour
              under the pointer would be the loudest thing in the view. The
              glyph is what says it is a control. */}
          <h4>
            <Collapsible.Trigger className="flex w-full items-baseline gap-2 border-b border-line pb-1 text-left transition-colors hover:border-fg-muted">
              <Heading title={title} count={items.length} state={state} />
              <Chevron open={open} className="ml-auto self-center text-fg-muted" />
            </Collapsible.Trigger>
          </h4>

          {/* Outside the content, so a cap that cut the evidence is still
              said over a table nobody has opened. */}
          <Cuts cut={cut} note={note} />

          <Collapsible.Content>
            {/* The first column is the subject and runs long; every column
                after it is fixed-width and reads down its right edge, which is
                what makes two byte counts comparable at a glance. */}
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
          </Collapsible.Content>
        </Collapsible.Root>
      ) : (
        <>
          <h4 className="flex items-baseline gap-2 border-b border-line pb-1 text-sm">
            <Heading title={title} count={items.length} state={state} />
          </h4>
          <Cuts cut={cut} note={note} />
          {/* No line under a measured zero. The heading says `0` and carries no
              glyph, which is the whole statement: the sensor was watching,
              nothing happened, and there is nothing here to open. A `none`
              under it was the same fact a second time. `not measured` still
              gets its sentence, because that one needs explaining. */}
          {state === "blind" ? (
            <p className="py-1.5 font-mono text-xs text-sev-high">
              The sensor behind this table was not running
              {detail ? ` — ${detail}` : ""}. What it would have seen is missing from the report,
              not missing from the run.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Sentence case, in the reading size, with the count beside the word and not at
 * the far end of a very wide column. It was an uppercase, wide-tracked
 * micro-label, which made four groups of evidence look like chrome.
 *
 * The count is the whole reason a shut table is still worth a line.
 */
function Heading({ title, count, state }: { title: string; count: number; state: GroupState }) {
  return (
    <>
      <span className="text-sm">{title}</span>
      <span className="font-mono text-xs text-fg-muted">
        {state === "blind" ? "not measured" : count}
      </span>
    </>
  );
}

function Cuts({ cut, note }: { cut?: boolean; note?: string }) {
  return (
    <>
      {cut ? <Note>the list below was cut at its cap</Note> : null}
      {note ? <Note>{note}</Note> : null}
    </>
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
