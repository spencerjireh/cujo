"use client";

import type { RunSummary } from "@/lib/api/types";
import { type Specimen, specimensFrom } from "@/lib/board/specimen";
import { focusStore, setFocusedRun, setSelectedRun, useFocusedRun } from "@/lib/board/store";
import { SEVERITY_ORDER, STATUS_LABELS, TONE_CHAMBER_VAR } from "@/lib/board/tone";
import { duration } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChamberFallback } from "./ChamberFallback";
import type { ChamberHandle } from "./chamber/scene";

/**
 * The chamber's lifecycle. The scene itself is in `chamber/scene.ts`; this owns
 * when it exists, what it holds, and when it is allowed to run.
 *
 * `three` is imported dynamically for two reasons that are not the same one:
 * it keeps a 600 kB library out of the first load, and it keeps it out of the
 * server bundle entirely — the module touches `window` at construction, and
 * Next would otherwise trace it into the standalone output.
 *
 * The fallback is not an error state. It is what renders on the server, what
 * stays for a browser with no WebGL, and what a small viewport gets instead of
 * a renderer it would spend a frame budget on.
 */

/**
 * Below this width the scene is a smear; the flat elevation says more.
 *
 * 768 rather than 640, and the change is a correction: this constant and the
 * CSS gate that hides the component have to agree, and they did not. The gate
 * was `lg` (1024) while this said 640, so between those widths the component
 * was hidden and the renderer would have started anyway had it ever been
 * shown. The gate is now `md`, and `md` is 768.
 */
const MIN_WIDTH = 768;
/**
 * How many runs the chamber draws. The record below still lists them all.
 *
 * Ten, down from twenty-four. A specimen is a solid now and the arms are two
 * thirds longer, so the same volume holds fewer of them before they overlap
 * into a thicket — and ten large objects a reader can tell apart is a better
 * drawing of a record than twenty-four dots that recede into one. What is lost
 * is the impression that a great many runs have happened, and the stats line
 * above and the record below both carry that number anyway.
 */
const CAPACITY = 10;
/** Kept clear of the frame edge, so the callout never hangs off the volume. */
const CALLOUT_MARGIN = 16;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Chamber({
  runs,
  updatedAt,
  pollMs,
  onLive,
}: {
  runs: RunSummary[];
  /**
   * When the list query last returned. A change is a poll landing, which is
   * what starts a sweep — the plane is the board re-reading the record, not a
   * timer that happens to look like one.
   */
  updatedAt: number;
  /** How long until the next one, so the sweep arrives as the read does. */
  pollMs: number;
  /**
   * True once the renderer came up. The page uses it to decide whether it may
   * tell a reader to click a specimen: the flat elevation underneath is a
   * picture, and inviting a click on one is an instruction that does nothing.
   */
  onLive?: (live: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ChamberHandle | null>(null);
  const [live, setLive] = useState(false);
  const focused = useFocusedRun();
  // Read through a ref inside the mount-scoped effect below, which must not
  // tear down and rebuild the scene because a parent passed a new closure.
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  const specimens = useMemo(() => specimensFrom(runs, CAPACITY), [runs]);
  // Read once per mount rather than per render: the scene is built around the
  // answer, so a change mid-session would need a rebuild anyway.
  const specimensRef = useRef(specimens);
  specimensRef.current = specimens;

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    let disposed = false;
    let starting = false;
    let handle: ChamberHandle | null = null;
    let onScreen = true;
    const reducedMotion = prefersReducedMotion();

    // Two gates on the loop, for the same reason the run list stops polling in
    // a background tab: a canvas nobody is looking at should not hold a core.
    const runIfWanted = () => {
      if (reducedMotion || !handle) return;
      if (onScreen && document.visibilityState === "visible") handle.start();
      else handle.stop();
    };

    /**
     * Move the callout to the specimen it names, clamped inside the frame.
     *
     * Written straight to the element and never through state: this is called
     * from the render loop, and a `setState` here would re-render the board
     * sixty times a second.
     */
    const anchor = (x: number | null, y: number | null) => {
      const node = calloutRef.current;
      if (!node) return;
      if (x === null || y === null) {
        node.style.opacity = "0";
        return;
      }
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const maxX = frame.clientWidth - width - CALLOUT_MARGIN;
      const maxY = frame.clientHeight - height - CALLOUT_MARGIN;
      const left = Math.min(Math.max(x + 18, CALLOUT_MARGIN), Math.max(maxX, CALLOUT_MARGIN));
      const top = Math.min(
        Math.max(y - height / 2, CALLOUT_MARGIN),
        Math.max(maxY, CALLOUT_MARGIN),
      );
      node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      node.style.opacity = "1";
    };

    /**
     * Build the scene, once, the first time the frame is wide enough.
     *
     * The width test cannot be a guard at the top of this effect. The narrow
     * layout hides this component with CSS rather than unmounting it, so a
     * page loaded narrow and then widened would keep a frame of zero width
     * and never run the effect again — the scene would stay unbuilt for the
     * rest of the session and the flat fallback would be all a desktop
     * visitor ever saw.
     */
    const startWhenWideEnough = () => {
      if (handle || starting || disposed) return;
      if (frame.clientWidth < MIN_WIDTH) return;
      starting = true;
      // The whole startup, import included, is inside the promise chain: a
      // rejected `import()` is the same outcome as a refused WebGL context —
      // no scene, and the fallback already on screen stays there. Without the
      // terminal `.catch()` it would instead be an unhandled rejection, since
      // the `try` below begins after the await.
      void (async () => {
        const { createChamber } = await import("./chamber/scene");
        if (disposed) return;
        let built: ChamberHandle;
        try {
          built = createChamber({
            canvas,
            capacity: CAPACITY,
            reducedMotion,
            onHover: setFocusedRun,
            // A click does not leave the board. It sends the record to the
            // run's row and marks it, which keeps the chamber and the log on
            // one screen — the whole reason they are on one page. The row's
            // own link is still the way to the run.
            onSelect: setSelectedRun,
            onAnchor: anchor,
          });
        } catch {
          // No WebGL context, or a driver that refused one. The fallback is
          // already on screen underneath; leaving `live` false keeps it there.
          return;
        }
        handle = built;
        handleRef.current = built;
        built.setSpecimens(specimensRef.current);
        // The store may already hold a focused run: a row can be hovered or
        // focused while the import is in flight, and that effect cannot
        // replay, because assigning a ref does not re-run one.
        built.setFocus(focusStore.state.runId);
        built.setSelection(focusStore.state.selectedId);
        built.resize(frame.clientWidth, frame.clientHeight);
        setLive(true);
        onLiveRef.current?.(true);
        // Through the gates rather than started outright: the frame may have
        // scrolled away or the tab been hidden while the import was in
        // flight, and no observer will fire again to correct it.
        runIfWanted();
      })().catch(() => {
        // Nothing to recover: the fallback is the design for exactly this.
      });
    };

    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      startWhenWideEnough();
      handle?.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resize.observe(frame);

    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      runIfWanted();
    });
    visible.observe(frame);
    document.addEventListener("visibilitychange", runIfWanted);

    // Parallax over the whole hero, not only over the canvas: the readout and
    // the wash above it are `pointer-events-none`, so a move anywhere in the
    // section lands here, and the volume answers the pointer before it is
    // touched. This is the cheapest depth in a scene with no lights.
    const onMove = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      handle?.setPointer(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        ((event.clientY - rect.top) / rect.height) * 2 - 1,
      );
    };
    const onLeave = () => handle?.setPointer(null, null);
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);

    startWhenWideEnough();

    return () => {
      disposed = true;
      resize.disconnect();
      visible.disconnect();
      document.removeEventListener("visibilitychange", runIfWanted);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerleave", onLeave);
      handleRef.current = null;
      handle?.dispose();
      onLiveRef.current?.(false);
      // The store is module state and outlives this component.
      setFocusedRun(null);
    };
    // Mount-scoped. Everything below is pushed in by the effects that follow
    // rather than rebuilding the scene.
  }, []);

  useEffect(() => {
    handleRef.current?.setSpecimens(specimens);
  }, [specimens]);

  useEffect(() => {
    handleRef.current?.setFocus(focused);
  }, [focused]);

  // Subscribed rather than read through a hook: the selection has no effect on
  // this component's own markup, so re-rendering the whole hero to push one
  // string into the scene would be a render for nothing.
  useEffect(() => {
    const subscription = focusStore.subscribe(() => {
      handleRef.current?.setSelection(focusStore.state.selectedId);
    });
    return () => subscription.unsubscribe();
  }, []);

  // A poll landed. `updatedAt` changes on every successful fetch, including the
  // ones that return an unchanged list — which is the honest signal, because
  // the sweep is drawing the read and not the change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `updatedAt` is the trigger, not an input — the effect reads only `pollMs`, and the timestamp is in the list precisely so a fetch that changed nothing still starts a sweep.
  useEffect(() => {
    handleRef.current?.pulse(pollMs);
  }, [updatedAt, pollMs]);

  const label = specimens.find((spec) => spec.id === focused);

  return (
    // Hidden from assistive technology as a whole, canvas and fallback alike:
    // every specimen in here is a real, focusable link in the record below,
    // which is the keyboard and screen-reader path to the same runs. Marked on
    // the frame rather than on the canvas, which is focusable and may not carry
    // `aria-hidden` itself.
    <div ref={frameRef} aria-hidden="true" className="relative h-full w-full">
      {/* Underneath the canvas, not swapped out: it is the server render, and
          it stays visible whenever the scene never came up. */}
      <div className={live ? "invisible absolute inset-0" : "absolute inset-0"}>
        <ChamberFallback specimens={specimens} />
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${live ? "" : "invisible"}`}
      />
      {/* Seats the volume in the page: without it the scene ends at a hard
          rectangle edge and reads as a picture of a box rather than a view
          into one. Painted over the canvas, so it takes no pointer events. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% 45%, transparent 45%, var(--chamber) 100%)",
        }}
      />
      {/* Positioned by the render loop, beside the specimen it names, so a
          hover on a record row points at a shape rather than only dimming the
          others. Kept mounted and faded, because measuring its size is what
          the clamp needs and an unmounted node has none. */}
      <div
        ref={calloutRef}
        className={`pointer-events-none absolute top-0 left-0 max-w-[22rem] border border-[var(--chamber-line)] bg-[var(--chamber)] px-3 py-2 font-mono text-xs transition-opacity duration-150 ${
          label ? "" : "opacity-0"
        }`}
      >
        {label ? <Callout spec={label} /> : null}
      </div>
    </div>
  );
}

/**
 * What the specimen is, in the order the shape reads: the pull request it is,
 * the verdict its core is drawing, how long the arms took, and what the marks
 * on its drop line are.
 */
function Callout({ spec }: { spec: Specimen }) {
  return (
    <>
      <p className="text-[var(--chamber-fg)]">{spec.pullRequest}</p>
      {spec.label !== spec.pullRequest ? (
        <p className="mt-1 truncate text-[var(--chamber-fg-muted)]">{spec.label}</p>
      ) : null}
      <p className="mt-1.5 text-[var(--chamber-fg-muted)]">
        {STATUS_LABELS[spec.status]}
        {spec.durationMs === null
          ? ""
          : ` · ${duration(new Date(0).toISOString(), new Date(spec.durationMs).toISOString()) ?? ""}`}
      </p>
      {spec.unmeasured ? (
        <p className="mt-1.5 text-[var(--chamber-fg-muted)]">no checks folded</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[var(--chamber-fg-muted)]">
            {spec.bars.map((bar) => (
              <li key={bar.name} className="flex items-baseline gap-1">
                {/* A check that never appeared is the wireframe colour, the
                    same gap the specimen draws instead of an arm. */}
                <span
                  className="inline-block h-1.5 w-1.5 translate-y-px"
                  style={{
                    background:
                      bar.outcome === "absent"
                        ? "var(--chamber-line)"
                        : `var(${TONE_CHAMBER_VAR[bar.tone]})`,
                  }}
                />
                {bar.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[var(--chamber-fg-muted)]">
            {spec.findingTotal === 0
              ? "no findings"
              : SEVERITY_ORDER.filter((severity) => spec.findings[severity] > 0)
                  .map((severity) => `${spec.findings[severity]} ${severity}`)
                  .join(" · ")}
          </p>
        </>
      )}
    </>
  );
}
