/**
 * One specimen, on its own, for the run page.
 *
 * The board draws the whole record; a run page is about one pull request, and
 * this is that run drawn as the same object the board drew. Same builder, same
 * rules, same colours — a shape that meant one thing in the chamber and another
 * here would make it decoration.
 *
 * What it deliberately does *not* pull in: `room.ts`, `atmosphere.ts` and
 * `post.ts`, and through them every `three/examples` addon. Those live only in
 * the board's chunk. This page is usually reached by a direct link from a
 * GitHub review comment, so it pays for `three` core and nothing else — and
 * even that only after the flat drawing is already on screen.
 *
 * Never import a constant from `scene.ts` here. One such import drags the
 * composer, the bloom pass and the line addons onto every run page, and nothing
 * would say so except the bundle.
 */

import { INLINE_RADIUS, inlineDistance } from "@/lib/board/chamber-camera";
import type { Specimen } from "@/lib/board/specimen";
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { readPalette } from "./palette";
import { type SpecimenNode, applySpecimenFrame, createSpecimenKit } from "./specimens";

/** Wide enough to be a portrait of the shape, long enough not to distort it. */
const FOV = 34;
/** Room around the specimen, so a four-armed one does not touch the edges. */
const MARGIN = 1.35;

export interface InlineSpecimenHandle {
  setSpecimen(spec: Specimen): void;
  /** The canvas is square, so one number. CSS pixels. */
  resize(size: number): void;
  dispose(): void;
}

export function createInlineSpecimen(options: {
  canvas: HTMLCanvasElement;
  specimen: Specimen;
  reducedMotion: boolean;
}): InlineSpecimenHandle {
  const { canvas } = options;
  const palette = readPalette();

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  // Transparent, unlike the board: this sits in the page's own column, and a
  // dark square behind it would be a window onto nothing.
  renderer.setClearColor(palette.chamber, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.set(0, 0, inlineDistance(FOV, INLINE_RADIUS, MARGIN));
  camera.lookAt(0, 0, 0);

  // No chain to hang from and no floor to land on, so the drop line, the
  // tether and the shadow are not drawn. Everything else about the shape is the
  // same object the chamber builds.
  //
  // No glow either, which is the one place this rig differs for a reason that
  // is not about the room. The sprite is drawn to be bloomed, and there is no
  // bloom pass here — at this size it is a smudge over the shape rather than
  // light coming off it, and it would make the canvas disagree with the flat
  // drawing underneath it. Two drawings of one run have to be one drawing.
  const kit = createSpecimenKit(palette, {
    dropAbove: 0,
    tetherY: null,
    ring: true,
    glow: false,
  });

  const holder = new Group();
  scene.add(holder);
  let node: SpecimenNode | null = null;

  function draw(): void {
    if (node) {
      applySpecimenFrame(node, {
        elapsed: 0,
        // At rest, always. The board's specimen breathes because the board is
        // watching a record change; this one is a portrait of a run the reader
        // is already reading about.
        reducedMotion: true,
        camera,
        focus: 0,
        dim: 0,
        read: 0,
        arrivalScale: 1,
        arrivalOpacity: 1,
      });
    }
    renderer.render(scene, camera);
  }

  function setSpecimen(spec: Specimen): void {
    if (node) kit.release(node);
    node = kit.build(spec);
    // Centred rather than at its slot: there is no time axis here, because
    // there is no record for it to be a position in.
    node.group.position.set(0, 0, 0);
    holder.add(node.group);
    draw();
  }

  function resize(size: number): void {
    const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    draw();
  }

  function dispose(): void {
    if (node) kit.release(node);
    node = null;
    kit.dispose();
    renderer.dispose();
  }

  setSpecimen(options.specimen);

  return { setSpecimen, resize, dispose };
}
