"use client";

import { Chamber } from "@/components/board/Chamber";
import { ChamberFallback } from "@/components/board/ChamberFallback";
import { HeroReadout } from "@/components/board/HeroReadout";
import { Legend } from "@/components/board/Legend";
import { ReadoutRack } from "@/components/board/ReadoutRack";
import { Record } from "@/components/board/Record";
import { HomeMark } from "@/components/brand/HomeMark";
import { POLL_LIVE_MS, POLL_QUIET_MS, runsListOptions } from "@/lib/api/queries";
import { boardMetrics } from "@/lib/board/metrics";
import { specimensFrom } from "@/lib/board/specimen";
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
  // Fewer than the scene draws: the margin strip is a hundred pixels wide and
  // the whole record in it would be a column of dots.
  const specimens = useMemo(() => specimensFrom(runs, 14), [runs]);
  const pollMs = metrics.live > 0 ? POLL_LIVE_MS : POLL_QUIET_MS;
  // Only the WebGL scene can be clicked, so only it may say so. The flat
  // elevation is a picture, and telling a reader to click one is a lie.
  const [sceneLive, setSceneLive] = useState(false);

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
        className="relative isolate h-[100svh] overflow-hidden bg-[var(--chamber)]"
      >
        {/* On the chamber, so it takes the pinned viewport tokens rather than
            the page's: this surface is a screen and stays dark in a lit room.
            Inside the section and not above it, because it is positioned
            against the chamber and scrolls away with it. */}
        <HomeMark tone="chamber" />
        {/* Two forms of the same record, because it is a long thin thing and a
            viewport is not always wide. From `md` up: the scene, framed by a
            camera that pulls back as the frame narrows so the record still
            fits. Below it: the chain hangs down the right margin, because the
            same drawing turned sideways scales to a sliver of dots — and
            because a phone should not be asked for a composed frame with a
            bloom pass in it. */}
        <div className="absolute inset-0 hidden md:block">
          <Chamber runs={runs} updatedAt={dataUpdatedAt} pollMs={pollMs} onLive={setSceneLive} />
        </div>
        <div className="absolute inset-y-0 right-0 w-20 sm:w-28 md:hidden" aria-hidden="true">
          <ChamberFallback specimens={specimens} orientation="vertical" />
        </div>
        {/* A ground for the type, and now a band under it rather than a wash
            across three fifths of the frame. The readout sits at the bottom
            left, over the chamber's floor — which is its darkest region — so
            the whole upper frame is the volume. */}
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
        <div className="pointer-events-none relative flex h-full items-end pr-24 pb-12 pl-4 sm:pr-32 md:pb-14 md:pl-8 lg:pr-12 lg:pl-12">
          <HeroReadout metrics={metrics} interactive={sceneLive} />
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
