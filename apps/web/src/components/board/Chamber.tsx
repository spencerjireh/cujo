"use client";

import type { RunSummary } from "@/lib/api/types";
import { specimensFrom } from "@/lib/board/specimen";
import { focusStore, setFocusedRun, useFocusedRun } from "@/lib/board/store";
import { STATUS_LABELS } from "@/lib/board/tone";
import { useRouter } from "next/navigation";
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

/** Below this width the scene is a smear; the flat elevation says more. */
const MIN_WIDTH = 640;
/** How many runs the chamber draws. The record below still lists them all. */
const CAPACITY = 24;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Chamber({ runs }: { runs: RunSummary[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ChamberHandle | null>(null);
  const [live, setLive] = useState(false);
  const router = useRouter();
  const focused = useFocusedRun();

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
            onSelect: (id) => {
              // Cleared before leaving: the store outlives this component, so
              // a run left focused here is still focused when the board is
              // next opened, with the pointer nowhere near it.
              setFocusedRun(null);
              router.push(`/runs/${id}`);
            },
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
        built.resize(frame.clientWidth, frame.clientHeight);
        setLive(true);
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
    startWhenWideEnough();

    return () => {
      disposed = true;
      resize.disconnect();
      visible.disconnect();
      document.removeEventListener("visibilitychange", runIfWanted);
      handleRef.current = null;
      handle?.dispose();
      // The store is module state and outlives this component.
      setFocusedRun(null);
    };
    // Mount-scoped. `specimens` and `focused` are pushed in by the effects
    // below rather than rebuilding the scene, and `router` is stable.
  }, [router]);

  useEffect(() => {
    handleRef.current?.setSpecimens(specimens);
  }, [specimens]);

  useEffect(() => {
    handleRef.current?.setFocus(focused);
  }, [focused]);

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
      {/* Bottom right, clear of the readout on the left and of the near end of
          the record. Named rather than only titled: a run is a pull request at
          a SHA, and the verdict is the thing the specimen's colour is saying. */}
      {label ? (
        <div className="pointer-events-none absolute right-6 bottom-6 max-w-[24rem] border border-[var(--chamber-line)] bg-[var(--chamber)] px-3 py-2 font-mono text-xs">
          <p className="text-[var(--chamber-fg)]">{label.pullRequest}</p>
          {label.label !== label.pullRequest ? (
            <p className="mt-1 truncate text-[var(--chamber-fg-muted)]">{label.label}</p>
          ) : null}
          <p className="mt-1 text-[var(--chamber-fg-muted)]">
            {STATUS_LABELS[label.status]}
            {label.unmeasured ? " · no checks folded" : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
