"use client";

import { Chamber } from "@/components/board/Chamber";
import { ChamberFallback } from "@/components/board/ChamberFallback";
import { HeroReadout } from "@/components/board/HeroReadout";
import { Legend } from "@/components/board/Legend";
import { ReadoutRack } from "@/components/board/ReadoutRack";
import { Record } from "@/components/board/Record";
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
      {/* The chamber is always dark and always full width: it is the
          instrument's viewport, and the page is the panel around it. The scene
          composes its record to the right of centre, so the readout sits in the
          left half rather than on top of the specimens. */}
      <section
        aria-label="The chamber"
        className="relative isolate overflow-hidden bg-[var(--chamber)]"
      >
        {/* Two forms of the same record, because it is a long thin thing and a
            viewport is not always wide. Wide: the scene, with the record
            running beside the headline, which is what the camera is framed for.
            Narrow: the chain hangs down the right margin, because the same
            drawing turned sideways scales to a sliver of dots. */}
        <div className="absolute inset-0 hidden lg:block">
          <Chamber runs={runs} updatedAt={dataUpdatedAt} pollMs={pollMs} onLive={setSceneLive} />
        </div>
        <div className="absolute inset-y-0 right-0 w-20 sm:w-28 lg:hidden" aria-hidden="true">
          <ChamberFallback specimens={specimens} orientation="vertical" />
        </div>
        {/* A ground for the type on the wide layout, where it sits over the
            scene. No box, no panel — the type just gets somewhere to sit. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-3/5 bg-gradient-to-r from-[var(--chamber)] from-40% to-transparent lg:block"
        />
        {/* `pointer-events-none` on both this and the wash above, because they
            are painted after the canvas and span it: whichever of them the
            pointer lands on is the hit target, and the chamber would never
            receive a hover, a click or a drag anywhere in the hero. Nothing in
            here is interactive — the readout is text, the wash is decoration —
            so nothing needs the events back, and the scene reads the pointer
            for parallax off the frame underneath. */}
        <div className="pointer-events-none relative flex min-h-[28rem] items-center py-16 pr-24 pl-4 sm:pr-32 md:pl-8 lg:min-h-[40rem] lg:pr-12 lg:pl-12">
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
