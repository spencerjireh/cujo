"use client";

import { Chamber, type ChamberStatus } from "@/components/board/Chamber";
import { HeroLead, HeroStats } from "@/components/board/HeroReadout";
import { Legend } from "@/components/board/Legend";
import { ReadoutRack } from "@/components/board/ReadoutRack";
import { Record } from "@/components/board/Record";
import { HomeMark } from "@/components/brand/HomeMark";
import { POLL_LIVE_MS, POLL_QUIET_MS, runsListOptions } from "@/lib/api/queries";
import { boardMetrics } from "@/lib/board/metrics";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

/**
 * The board: the chamber, the rack, the record, the key.
 *
 * One query feeds all of them (`runsListOptions`, polling at 5 s while anything
 * is live and 30 s otherwise), and every number below is derived from it in the
 * browser. There is no aggregate endpoint and the page does not want one — the
 * whole list arrives in a single response.
 *
 * That poll is also what drives the chamber's sweep: the plane crossing the
 * volume is the board re-reading the record, so it is handed the same interval
 * `runsListOptions` is using rather than a duration of its own.
 */
export function RunsView() {
  const { data, error, isPending, dataUpdatedAt } = useQuery(runsListOptions());
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const metrics = useMemo(() => boardMetrics(runs), [runs]);
  const pollMs = metrics.live > 0 ? POLL_LIVE_MS : POLL_QUIET_MS;
  /**
   * What the renderer is doing, which decides two things.
   *
   * Only a live scene may be told to click a specimen. And only a scene that
   * will never come up collapses the hero: `pending` holds the screen open,
   * because a canvas is a moment away and a hero that shrank and then grew
   * again would be worse than one that waited.
   */
  const [scene, setScene] = useState<ChamberStatus>("pending");

  if (error) {
    return (
      <div className="px-4 py-16 md:px-6">
        <p className="font-mono text-sm text-sev-critical">
          The run list could not be loaded. Check that the Cujo API is reachable, then reload.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* The chamber is always dark, always full width, and now the whole first
          screen: it is the instrument's viewport, and the page is the panel
          around it. It used to be a 40rem band under a bordered header, with a
          wash over three fifths of it — so most of the hero was not the scene,
          and the product's central claim was a strip. The record starts below
          the fold, which is the trade: the board says what it is first and
          lists what it has second. */}
      <section
        aria-label="The chamber"
        className={`relative isolate overflow-hidden bg-[var(--chamber)] ${
          scene === "unavailable" ? "" : "md:h-[100svh]"
        }`}
      >
        {/* On the chamber, so it takes the pinned viewport tokens rather than
            the page's: this surface is a screen and stays dark in a lit room.
            Inside the section and not above it, because it is positioned
            against the chamber and scrolls away with it. */}
        <HomeMark tone="chamber" />
        {/* From `md` up, and only there. Below it there is no drawing at all:
            the record is a long thin thing, the same picture turned sideways in
            a hundred-pixel margin was a column of dots, and a phone should not
            be asked for a composed frame with a bloom pass in it either way. A
            phone reader came for the runs, so a phone gets the runs. */}
        <div className="absolute inset-0 hidden md:block">
          <Chamber runs={runs} updatedAt={dataUpdatedAt} pollMs={pollMs} onStatus={setScene} />
        </div>
        {/* A ground for the type, at both ends of the frame now that the
            readout is at both ends of it. The bottom band is the deeper of the
            two, because the stats sit over the chamber's floor where the rails
            and the ticks are; the top one only has to carry a headline over the
            ceiling structure, which is fainter. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[var(--chamber)]/90 via-[var(--chamber)]/45 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[var(--chamber)] from-25% via-[var(--chamber)]/80 to-transparent"
        />
        {/* `pointer-events-none` on both this and the wash above, because they
            are painted after the canvas and span it: whichever of them the
            pointer lands on is the hit target, and the chamber would never
            receive a hover, a click or a drag anywhere in the hero. Nothing in
            here is interactive — the readout is text, the wash is decoration —
            so nothing needs the events back, and the scene reads the pointer
            for parallax off the frame underneath. */}
        {/* `gap-10` rather than `justify-between` alone: with no chamber to
            hold the section open the two halves have no height to be pushed
            apart by, and would otherwise sit against each other. */}
        <div className="pointer-events-none relative flex h-full flex-col justify-between gap-10 px-4 pt-16 pb-12 md:pt-20 md:pr-12 md:pb-14 md:pl-8 lg:pl-12">
          <HeroLead metrics={metrics} />
          <HeroStats metrics={metrics} interactive={scene === "live"} />
        </div>
      </section>

      {isPending ? (
        <p className="border-line border-t px-4 py-6 font-mono text-xs text-fg-muted md:px-6">
          Loading the record…
        </p>
      ) : (
        <>
          {/* The rack renders on an empty board too, disarmed. A board with no
              runs is an instrument that has not read anything yet, not a page
              missing its middle. */}
          <ReadoutRack metrics={metrics} />
          <div className="border-line border-t">
            <Record runs={runs} />
          </div>
          <Legend />
        </>
      )}
    </div>
  );
}
