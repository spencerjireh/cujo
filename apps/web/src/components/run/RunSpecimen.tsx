"use client";

import type { InlineSpecimenHandle } from "@/components/board/chamber/inline";
import type { Run } from "@/lib/api/types";
import { digestFrom } from "@/lib/board/digest";
import { specimensFrom } from "@/lib/board/specimen";
import { prefersReducedMotion } from "@/lib/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { SpecimenGlyph } from "./SpecimenGlyph";

/**
 * This run, as the shape the chamber would draw it.
 *
 * The board's whole argument is that a run has a silhouette — rings sized by
 * how long each check watched, a core sized by the worst thing it found — and until
 * now that argument stopped at the board. A reader who followed a specimen to
 * its run page lost the object they had just clicked on.
 *
 * It turns, and it carries the run's own live signals. The flat drawing renders
 * immediately and the canvas replaces it once `three` has loaded. That order
 * matters here more than it does on the board: this page is usually reached
 * from a link in a GitHub review comment, so a reader is arriving cold, and six
 * hundred kilobytes of renderer between them and the findings would be the
 * wrong trade. The same swap is what a browser with no WebGL gets permanently.
 *
 * The specimen is built from the detail shape, not from a list row: the stream
 * patches only `status` and `updated_at` into a row, so a live run's published
 * digest is stale, and `digestFrom` computes a fresh one from the checks and
 * findings this page already has.
 */

/**
 * The frame.
 *
 * It used to be a bare 128-pixel square, which is a thumbnail: the object this
 * page is largely about was the smallest thing in its own header. It is now the
 * height of the title block it stands beside, and it stands on the page
 * itself. For a while it sat on a bordered panel in the chamber's pinned-dark
 * ground, as a window onto the instrument; on a light page that was a black
 * square in the header, the one thing on the page that did not follow the
 * reader's theme, and a specimen on its own is not the chamber. So the drawing
 * takes the page's tokens instead (decision 95): the same severity colours as
 * the badge beside it, inverting with it.
 *
 * Two sizes, because the header wraps: at full width it stands beside the
 * title, and on a narrow screen it lands under it, where 224 pixels of it would
 * be most of a phone's first screen.
 */
const FRAME = "w-40 md:w-56";

/**
 * Runs `onChange` whenever the theme the page resolves to changes: an explicit
 * toggle writes `data-theme` on the root, and with no attribute the page follows
 * `prefers-color-scheme`, so both have to be watched. The theme store holds the
 * choice, not the resolution, and the blocking script in `layout.tsx` writes
 * the attribute without going through it, so the document is the one source
 * that always agrees with what the tokens resolved to.
 */
function watchResolvedTheme(onChange: () => void): () => void {
  const root = document.documentElement;
  const attribute = new MutationObserver(onChange);
  attribute.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onChange);
  return () => {
    attribute.disconnect();
    scheme.removeEventListener("change", onChange);
  };
}

export function RunSpecimen({ run }: { run: Run }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<InlineSpecimenHandle | null>(null);
  const [live, setLive] = useState(false);

  // `Run extends RunSummary`, so this is the same call the board makes — with a
  // digest derived here rather than served, since the detail route sends none.
  const specimen = useMemo(
    () => specimensFrom([{ ...run, digest: digestFrom(run) }], 1)[0] ?? null,
    [run],
  );

  const specimenRef = useRef(specimen);
  specimenRef.current = specimen;

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !specimenRef.current) return;

    let disposed = false;
    let handle: InlineSpecimenHandle | null = null;
    let onScreen = true;

    const runIfWanted = () => {
      handle?.setRunning(onScreen && document.visibilityState === "visible");
    };

    /**
     * A run page is long and the specimen is at the top of it, so most of the
     * time a reader spends here it is off screen. Same reason the board stops
     * its loop when the hero scrolls away: a canvas nobody is looking at should
     * not hold a core.
     */
    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      runIfWanted();
    });
    visible.observe(frame);

    // The frame is sized in CSS and changes at `md`, so the renderer is told
    // what it got rather than a constant. Square by construction, so the width
    // is the whole answer.
    const resize = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width;
      if (width) handle?.resize(width);
    });
    resize.observe(frame);
    document.addEventListener("visibilitychange", runIfWanted);
    // The canvas bakes the page's colours into its materials when it is built,
    // and the flat drawing under it uses custom properties and follows the
    // theme on its own. Without this a toggle would leave the two disagreeing.
    const unwatchTheme = watchResolvedTheme(() => handle?.repaint());

    // The whole startup is inside the promise chain, import included: a
    // rejected `import()` is the same outcome as a refused WebGL context — no
    // canvas, and the flat drawing already on screen stays there.
    void (async () => {
      const { createInlineSpecimen } = await import("@/components/board/chamber/inline");
      const spec = specimenRef.current;
      if (disposed || !spec) return;
      let built: InlineSpecimenHandle;
      try {
        built = createInlineSpecimen({
          canvas,
          specimen: spec,
          reducedMotion: prefersReducedMotion(),
        });
      } catch {
        // No WebGL context, or a driver that refused one.
        return;
      }
      handle = built;
      handleRef.current = built;
      // The observer fires on its own only when the box changes, and by now it
      // has already reported the size it had before the import resolved.
      built.resize(frame.getBoundingClientRect().width);
      setLive(true);
      // Through the gate rather than started outright: the page may have
      // scrolled past while the import was in flight, and no observer will
      // fire again to correct it.
      runIfWanted();
    })().catch(() => {
      // The flat drawing is the design for exactly this, so there is nothing
      // to show. There may be something to let go of: a renderer that was
      // built and then failed to size or start would otherwise hold its
      // context until the page unloads.
      handle?.dispose();
      handle = null;
      handleRef.current = null;
      setLive(false);
    });

    return () => {
      disposed = true;
      visible.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", runIfWanted);
      unwatchTheme();
      handleRef.current = null;
      handle?.dispose();
      setLive(false);
    };
  }, []);

  // The run updates over the stream while it is live, and the shape has to
  // follow: a ring that stopped growing when the page loaded would be a
  // drawing of a moment rather than of the run.
  useEffect(() => {
    if (specimen) handleRef.current?.setSpecimen(specimen);
  }, [specimen]);

  if (!specimen) return null;

  return (
    // Hidden from assistive technology: everything it draws is stated in words
    // on this page — the timeline, the findings list and the status badge — so
    // a screen reader meets the facts rather than a description of a picture.
    <div aria-hidden="true" className="shrink-0 p-3">
      <div ref={frameRef} className={`relative aspect-square ${FRAME}`}>
        <div className={live ? "invisible absolute inset-0" : "absolute inset-0"}>
          <SpecimenGlyph specimen={specimen} ground="page" />
        </div>
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full ${live ? "" : "invisible"}`}
        />
      </div>
    </div>
  );
}
