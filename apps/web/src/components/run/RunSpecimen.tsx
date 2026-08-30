"use client";

import type { InlineSpecimenHandle } from "@/components/board/chamber/inline";
import type { Run } from "@/lib/api/types";
import { digestFrom } from "@/lib/board/digest";
import { specimensFrom } from "@/lib/board/specimen";
import { useEffect, useMemo, useRef, useState } from "react";
import { SpecimenGlyph } from "./SpecimenGlyph";

/**
 * This run, as the shape the chamber would draw it.
 *
 * The board's whole argument is that a run has a silhouette — arms sized by how
 * long each check watched, a core sized by the worst thing it found — and until
 * now that argument stopped at the board. A reader who followed a specimen to
 * its run page lost the object they had just clicked on.
 *
 * The flat drawing renders immediately and the canvas replaces it once `three`
 * has loaded. That order matters here more than it does on the board: this page
 * is usually reached from a link in a GitHub review comment, so a reader is
 * arriving cold, and six hundred kilobytes of renderer between them and the
 * findings would be the wrong trade. The same swap is what a browser with no
 * WebGL gets permanently, which is the fallback the board already relies on.
 *
 * The specimen is built from the detail shape, not from a list row: the stream
 * patches only `status` and `updated_at` into a row, so a live run's published
 * digest is stale, and `digestFrom` computes a fresh one from the checks and
 * findings this page already has.
 */

const SIZE = 88;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function RunSpecimen({ run }: { run: Run }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    if (!canvas || !specimenRef.current) return;

    let disposed = false;
    let handle: InlineSpecimenHandle | null = null;

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
      built.resize(SIZE);
      setLive(true);
    })().catch(() => {
      // Nothing to recover: the flat drawing is the design for exactly this.
    });

    return () => {
      disposed = true;
      handleRef.current = null;
      handle?.dispose();
      setLive(false);
    };
  }, []);

  // The run updates over the stream while it is live, and the shape has to
  // follow: an arm that stopped growing when the page loaded would be a
  // drawing of a moment rather than of the run.
  useEffect(() => {
    if (specimen) handleRef.current?.setSpecimen(specimen);
  }, [specimen]);

  if (!specimen) return null;

  return (
    // Hidden from assistive technology: everything it draws is stated in words
    // on this page — the timeline, the findings list and the status badge — so
    // a screen reader meets the facts rather than a description of a picture.
    <div aria-hidden="true" className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <div className={live ? "invisible absolute inset-0" : "absolute inset-0"}>
        <SpecimenGlyph specimen={specimen} />
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${live ? "" : "invisible"}`}
      />
    </div>
  );
}
