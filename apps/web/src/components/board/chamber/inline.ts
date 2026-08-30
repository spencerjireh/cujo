/**
 * One specimen, on its own, for the run page.
 *
 * The board draws the whole record; a run page is about one pull request, and
 * this is that run drawn as the same object the board drew. Same builder, same
 * rules, same colours — a shape that meant one thing in the chamber and another
 * here would make it decoration.
 *
 * It turns. A specimen is a solid now (decision 70) and a still one is a
 * silhouette of a solid, which is the picture this page had before: an object
 * with three dimensions, drawn as though it had two. The rotation carries no
 * data and is decoration by the same rule that admits the haze and the glow;
 * what it shows is the shape, which is entirely measurement.
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
/**
 * Room around the specimen, so a four-armed one does not touch the edges.
 *
 * Tight, because it turns: `INLINE_RADIUS` is the longest arm the chamber
 * draws, and an arm that reaches straight across the frame is the widest this
 * shape ever gets from any angle. A wider margin than that is a specimen drawn
 * smaller than the box it was given.
 */
const MARGIN = 1.12;

/**
 * One turn, in seconds. Slow enough to read as inspection rather than as a
 * loading spinner, which is what anything under about ten seconds becomes.
 */
const TURN_SECONDS = 26;
/**
 * A fixed tilt off the vertical, so the turn shows the rings' depth and not
 * only their outline: spun about the view axis a system is a flat drawing
 * rotating; tilted, every ring opens and closes in its own time.
 */
const TILT = 0.42;

export interface InlineSpecimenHandle {
  setSpecimen(spec: Specimen): void;
  /** The canvas is square, so one number. CSS pixels. */
  resize(size: number): void;
  /**
   * Run the loop, or stop it. The page stops it when the specimen scrolls out
   * of view: a run page is long, and nothing should turn where nobody is.
   */
  setRunning(running: boolean): void;
  dispose(): void;
}

export function createInlineSpecimen(options: {
  canvas: HTMLCanvasElement;
  specimen: Specimen;
  reducedMotion: boolean;
}): InlineSpecimenHandle {
  const { canvas, reducedMotion } = options;
  const palette = readPalette();

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  // Transparent, unlike the board: this sits in the page's own column, and a
  // dark square behind it would be a window onto nothing.
  renderer.setClearColor(palette.chamber, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.set(0, 0, inlineDistance(FOV, INLINE_RADIUS, MARGIN));
  camera.lookAt(0, 0, 0);

  // No glow, which is the one place this rig differs from the board's. The
  // sprite is drawn to be bloomed, and there is no bloom pass here — at this
  // size it is a smudge over the shape rather than light coming off it, and it
  // would make the canvas disagree with the flat drawing underneath it. Two
  // drawings of one run have to be one drawing.
  const kit = createSpecimenKit(palette, { ring: true, glow: false });

  const holder = new Group();
  holder.rotation.x = TILT;
  scene.add(holder);
  let node: SpecimenNode | null = null;

  let frame = 0;
  let startedAt = 0;
  let elapsed = 0;

  function draw(): void {
    if (node) {
      // The turn is on the holder, so the specimen's own frame is unrotated and
      // every rule inside `applySpecimenFrame` — the ring facing the camera,
      // the running arm's reach — reads exactly as it does on the board.
      holder.rotation.y = reducedMotion ? 0 : (elapsed / TURN_SECONDS) * Math.PI * 2;
      applySpecimenFrame(node, {
        elapsed,
        // The run's own signals, when the reader wants motion: the specimen
        // breathes while the run is live, a running check's arm reaches and
        // retracts, and the live pulse leaves it. Those are measurements, and
        // the board draws them; there is no reason this page should not.
        reducedMotion,
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

  function tick(now: number): void {
    if (startedAt === 0) startedAt = now;
    elapsed = (now - startedAt) / 1000;
    draw();
    frame = requestAnimationFrame(tick);
  }

  function setRunning(running: boolean): void {
    if (reducedMotion) return;
    if (running) {
      if (frame !== 0) return;
      frame = requestAnimationFrame(tick);
      return;
    }
    if (frame === 0) return;
    cancelAnimationFrame(frame);
    frame = 0;
    // Left where it stopped rather than reset: a specimen that snapped back to
    // its start every time it scrolled past would be a worse drawing than one
    // that simply waits.
    startedAt = 0;
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
    setRunning(false);
    if (node) kit.release(node);
    node = null;
    kit.dispose();
    renderer.dispose();
  }

  setSpecimen(options.specimen);

  return { setSpecimen, resize, setRunning, dispose };
}
