"use client";

import { Chamber, type ChamberStatus } from "@/components/board/Chamber";
import { HeroLead, HeroStats } from "@/components/board/HeroReadout";
import { Legend } from "@/components/board/Legend";
import { ReadoutRack } from "@/components/board/ReadoutRack";
import { Record } from "@/components/board/Record";
import { SpecimenKey } from "@/components/board/SpecimenKey";
import { HomeMark } from "@/components/brand/HomeMark";
import { POLL_LIVE_MS, POLL_QUIET_MS, runsListOptions } from "@/lib/api/queries";
import { boardMetrics } from "@/lib/board/metrics";
import { useFocusedRun } from "@/lib/board/store";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The board: the chamber, the rack, the record, the key.
 *
 * One query feeds all of them (`runsListOptions`, polling at 5 s while anything
 * is live and 30 s otherwise), and every number below is derived from it in the
 * browser. There is no aggregate endpoint and the page does not want one — the
 * whole list arrives in a single response.
 *
 * That poll is also what drives the chamber's wash: the light walking the
 * galaxy is the board re-reading the record, so it is handed the same interval
 * `runsListOptions` is using rather than a duration of its own.
 */

/**
 * How long the pointer must rest on one specimen before the key replaces the
 * readings (decision 102). Long enough that a sweep across the galaxy is over
 * before it elapses; short enough that a reader who parks on a star to ask
 * what its parts are gets the answer while still looking at it.
 */
const KEY_DWELL_MS = 3000;

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
  /**
   * Whether the pointer has been resting on one specimen long enough for the
   * hero to show the key instead of the readings. Which specimen is meant
   * still comes from the same store the chamber and the record write — the
   * row lights the star, and the key explains the star — but a sweep across
   * the galaxy is a scan, and a scan that swapped the block under it
   * flickered the readings away for every star it crossed (decision 102). So
   * the swap waits: the timer restarts on every change of focused run, it
   * commits once when one run has held the pointer for the whole dwell, and
   * a leave hands the readings back at once.
   */
  const [dwelled, setDwelled] = useState(false);
  const focusedRun = useFocusedRun();
  useEffect(() => {
    if (focusedRun === null || scene !== "live") {
      setDwelled(false);
      return;
    }
    const timer = setTimeout(() => setDwelled(true), KEY_DWELL_MS);
    return () => clearTimeout(timer);
  }, [focusedRun, scene]);
  const keyed = dwelled && focusedRun !== null && scene === "live";
  /**
   * Whether the record has slid up over the whole hero. The hero is sticky
   * and the sheet below scrolls over it, so the chamber's own frame never
   * leaves the viewport — it is only ever covered — and its intersection
   * observer would keep the loop running under a sheet nobody can see
   * through. A sentinel at the top of the sheet is what actually scrolls.
   */
  const [covered, setCovered] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Covered once the sentinel has passed the top of the viewport. Not
      // "not intersecting": it is also not intersecting while below the
      // fold, before the reader has scrolled at all.
      const rect = entry?.boundingClientRect;
      setCovered(entry?.isIntersecting === false && rect !== undefined && rect.top <= 0);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  if (error) {
    return (
      <div className="px-4 py-16 md:px-6">
        <p className="font-mono text-sm text-sev-critical">
          The run list could not be loaded. Check that the Cujo API is reachable, then reload.
        </p>
      </div>
    );
  }

  const pinned = scene !== "unavailable";

  return (
    <div>
      {/* The chamber is always dark, always full width, and the whole first
          screen: it is the instrument's viewport, and the page is the panel
          around it. From `md` up it is also pinned — the record does not
          scroll the chamber away, it rises over it as a sheet, so the galaxy
          is the ground the rest of the board sits on rather than a banner
          the reader leaves behind. Below `md` there is no chamber and the
          hero is a readout, which has no business being pinned. */}
      <section
        aria-label="The chamber"
        className={`relative isolate overflow-hidden bg-[var(--chamber)] ${
          pinned ? "z-0 md:sticky md:top-0 md:h-[100svh]" : ""
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
          <Chamber
            runs={runs}
            updatedAt={dataUpdatedAt}
            pollMs={pollMs}
            onStatus={setScene}
            active={!covered}
          />
        </div>
        {/* A ground for the type, at both ends of the frame now that the
            readout is at both ends of it. The bottom band is the deeper of the
            two, because the stats sit over the front of the galaxy; it is
            shallower than it was (decision 83) — solid only for the last
            tenth and gone by a third of the way up — because at half the
            frame it covered the front layer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[var(--chamber)]/90 via-[var(--chamber)]/45 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-[var(--chamber)] from-10% via-[var(--chamber)]/55 via-45% to-transparent"
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
          {/* The bottom block is two things in one place: the readings, and
              the key. Once the pointer has rested on one specimen for the
              dwell (decision 102) the readings fade and the key fades in, so
              what the reader is looking at is explained where they were
              already reading. Both stay mounted and stacked on one grid cell,
              so the swap moves nothing else. The key only takes over on a
              device with a pointer that can hover: on a phone there is no
              chamber and nothing to hover, and a key that appeared on a tap
              would replace the readings for no reason. */}
          <div className="grid">
            <div
              className={`col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none ${
                keyed ? "[@media(hover:hover)]:opacity-0" : ""
              }`}
              aria-hidden={keyed || undefined}
            >
              <HeroStats metrics={metrics} interactive={scene === "live"} />
            </div>
            <div
              className={`col-start-1 row-start-1 self-end opacity-0 transition-opacity duration-200 motion-reduce:transition-none ${
                keyed ? "[@media(hover:hover)]:opacity-100" : ""
              }`}
              aria-hidden={!keyed || undefined}
            >
              <SpecimenKey />
            </div>
          </div>
        </div>
      </section>

      {/* In flow, unlike the sticky hero above it, so it scrolls: when it
          reaches the top of the viewport the sheet has covered the chamber. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {/* The sheet. Above the hero in the stacking order and opaque, so it
          rises over the galaxy rather than through it, with a hairline and a
          shadow at its top edge so the edge reads as an edge. */}
      <div className="relative z-10 border-line border-t bg-bg md:shadow-[0_-32px_64px_-24px_rgba(0,0,0,0.55)]">
        {isPending ? (
          <p className="px-4 py-6 font-mono text-xs text-fg-muted md:px-6">Loading the record…</p>
        ) : (
          <>
            {/* The rack renders on an empty board too, disarmed. A board with
                no runs is an instrument that has not read anything yet, not a
                page missing its middle. */}
            <ReadoutRack metrics={metrics} />
            <div className="border-line border-t">
              <Record runs={runs} />
            </div>
            <Legend />
          </>
        )}
      </div>
    </div>
  );
}
