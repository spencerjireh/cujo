/**
 * The chamber: a galaxy of the run history, five layers deep.
 *
 * Imperative and framework-free on purpose. React owns when this exists and
 * what data it holds; this file owns the renderer, the camera, the pointer and
 * the loop, and composes four modules that own everything else — the gates,
 * the specimens, the air, and the passes the frame is drawn through.
 *
 * The rules, from decision 68 as amended by 69, 70 and 71:
 *
 * - **No geometry exists that is not a measurement.** A gate is drawn only for
 *   a layer that holds a run, and the sweep is the board re-reading the API.
 *   Anything that could be moved, resized or recoloured without a fact changing
 *   does not belong in `room.ts` or `specimens.ts`.
 * - **The exception is air, and it is one file.** `atmosphere.ts` and `post.ts`
 *   are decorative and carry no data. That is the whole of decision 69, and it
 *   is stated as a boundary so a reader can check it by looking at two imports.
 * - **Depth is time, in five layers.** The newest runs are nearest; each layer
 *   behind holds older ones. Where a run sits within its layer is a function
 *   of its id and means nothing (decision 70).
 * - **Every specimen is drawn from its own digest.** Ring radii are check
 *   durations on one shared scale, ring colours are how each check ended, the
 *   core is the verdict at a size set by the worst thing the run found.
 *
 * Materials are unlit: this is an instrument face, not a lit room, so there are
 * no lights to tune and nothing costs a shadow pass. Depth is bought with what
 * a technical drawing uses instead — recession, fog, the gates, parallax — and
 * with a graded backdrop and a star field behind all of it.
 */

import { arrivalCurve, diffRecord, slideProgress } from "@/lib/board/arrival";
import { PITCH_LIMIT, YAW_LIMIT, cameraDrift, cameraPlacement } from "@/lib/board/chamber-camera";
import { LAYER_COUNT, sparseness } from "@/lib/board/chamber-layout";
import { approach, clamp } from "@/lib/board/ease";
import { layerOf, placeAt } from "@/lib/board/galaxy";
import { type Specimen, specimenSignature } from "@/lib/board/specimen";
import {
  SWEEP_MAX_SECONDS,
  SWEEP_MIN_SECONDS,
  readStrength,
  sweepPhase,
  sweepZ,
} from "@/lib/board/sweep";
import { Fog, Group, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from "three";
import { WebGLRenderer } from "three";
import { createAtmosphere } from "./atmosphere";
import { readPalette } from "./palette";
import { createPost } from "./post";
import { createRoom } from "./room";
import {
  type SpecimenNode,
  applySpecimenFrame,
  createSpecimenKit,
  snapSpecimen,
} from "./specimens";

/** The lens. Wider than the 30° it was: a full-height frame wants some drama. */
const FOV = 36;
/** How fast focus and dim settle. Decay per second — smaller is faster. */
const FOCUS_RATE = 0.0008;
/** How long the record takes to slide back one slot when a run lands. */
const SLIDE_SECONDS = 0.9;
/** How long a new run takes to ease into the front slot. */
const ARRIVE_SECONDS = 1.1;

export interface ChamberHandle {
  /** Replace the record. Cheap enough to call on every poll. */
  setSpecimens(next: Specimen[]): void;
  /** Highlight one run, or none. Driven by the record's hover as well as ours. */
  setFocus(id: string | null): void;
  /** Hold one run lit because it was picked, which outlives the pointer. */
  setSelection(id: string | null): void;
  /**
   * A poll landed. Starts one sweep back to front over `intervalMs`, so the
   * plane's position is how far the board is from reading the record again.
   */
  pulse(intervalMs: number): void;
  /** Pointer position over the hero, normalised to −1…1. Null when it leaves. */
  setPointer(x: number | null, y: number | null): void;
  resize(width: number, height: number): void;
  /** One frame, for reduced motion. */
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export interface ChamberOptions {
  canvas: HTMLCanvasElement;
  /** How many runs to draw. Fewer on a small screen. */
  capacity: number;
  reducedMotion: boolean;
  onHover(id: string | null): void;
  /** Null when the click landed on the volume and not on a specimen. */
  onSelect(id: string | null): void;
  /**
   * Where the lit specimen is on the canvas, in CSS pixels, so the callout can
   * sit beside the thing it names. Null when nothing is lit.
   *
   * Called from the render loop, so it must write to the DOM directly and never
   * set React state — sixty re-renders a second of the record is the exact cost
   * `focusStore` exists to avoid.
   */
  onAnchor(x: number | null, y: number | null): void;
}

export function createChamber(options: ChamberOptions): ChamberHandle {
  const { canvas, onHover, onSelect } = options;
  const palette = readPalette();

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(palette.chamber, 1);
  const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(dpr);
  /** In CSS pixels, which is the frame the callout is positioned in. */
  const viewport = { width: 1, height: 1 };

  const scene = new Scene();
  // The fog is the far end. It does the work a horizon does in a photograph:
  // it says the record continues past what is drawn, rather than stopping.
  // It starts past the front layer, so the newest stars — the ones every
  // reader looks at first — keep their whole colour, and it takes the back
  // layer most of the way to the ground without taking its silhouette.
  scene.fog = new Fog(palette.chamber, 3.5, 14);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  // The camera is in the scene because the backdrop hangs off it: parented that
  // way it is always exactly behind everything, at any angle.
  scene.add(camera);

  const room = createRoom(palette);
  scene.add(room.group);

  const atmosphere = createAtmosphere(palette);
  scene.add(atmosphere.group);
  camera.add(atmosphere.backdrop);

  // Constructed after the pixel ratio is set: `EffectComposer` snapshots the
  // renderer's ratio in its constructor.
  const post = createPost({ renderer, scene, camera });

  const kit = createSpecimenKit(palette, { ring: true, glow: true });

  const specimens = new Group();
  scene.add(specimens);
  let nodes: SpecimenNode[] = [];
  let focus: string | null = null;
  let selection: string | null = null;
  /** 0 with a full record, 1 with one run. Eased toward, so a landing glides. */
  let sparse = 0;
  let sparseTarget = 0;

  // --- the record -----------------------------------------------------------

  function clearNodes(): void {
    for (const node of nodes) kit.release(node);
    nodes = [];
  }

  /**
   * Where a run sits, part way between two slots.
   *
   * Depth is the layer, which is time. Within the layer the place comes from
   * `placeAt`, seeded off the run's id and carrying nothing (decision 70). A
   * run sliding from one slot to the next moves in a straight line between
   * the two places, which may be in two different layers.
   */
  function seat(node: SpecimenNode, t: number, lead: number): void {
    const from = node.slideOrigin ?? placeAt(node.slotFrom, node.spec.id);
    const to = placeAt(node.slotTo, node.spec.id);
    node.group.position.set(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t + lead,
    );
  }

  function place(node: SpecimenNode, index: number): void {
    node.slotFrom = index;
    node.slotTo = index;
    node.slideFrom = -1;
    node.slideOrigin = null;
    seat(node, 1, 0);
  }

  function add(spec: Specimen): SpecimenNode {
    const node = kit.build(spec);
    specimens.add(node.group);
    return node;
  }

  function setSpecimens(next: Specimen[]): void {
    const drawn = next.slice(0, options.capacity);
    const diff = diffRecord(
      nodes.map((node) => node.spec.id),
      drawn.map((spec) => spec.id),
    );
    const byId = new Map(drawn.map((spec) => [spec.id, spec]));

    if (diff.kind === "rebuild" || options.reducedMotion) {
      clearNodes();
      nodes = drawn.map((spec) => {
        const node = add(spec);
        place(node, spec.index);
        snapSpecimen(node, 0, 0);
        return node;
      });
    } else if (diff.kind === "same") {
      // Same ids in the same order. Only a node whose *drawing* changed is
      // rebuilt — a poll returns an equal record almost every time, and
      // rebuilding thirty nodes to redraw the same picture is what this
      // comparison exists to avoid.
      nodes = nodes.map((node) => {
        const spec = byId.get(node.spec.id);
        if (!spec) return node;
        if (specimenSignature(spec) === specimenSignature(node.spec)) {
          node.spec = spec;
          return node;
        }
        const rebuilt = add(spec);
        // Keep where it was and where it was going: a run whose detonation just
        // went red has not moved, and must not re-enter.
        rebuilt.slotFrom = node.slotFrom;
        rebuilt.slotTo = node.slotTo;
        rebuilt.slideFrom = node.slideFrom;
        rebuilt.slideOrigin = node.slideOrigin;
        rebuilt.arriveFrom = node.arriveFrom;
        rebuilt.focusAmount = node.focusAmount;
        rebuilt.dimAmount = node.dimAmount;
        kit.release(node);
        return rebuilt;
      });
    } else {
      // An advance: runs landed at the head and the record slides back.
      const kept = new Map(nodes.map((node) => [node.spec.id, node]));
      for (const id of diff.leaving) {
        const node = kept.get(id);
        // Released outright rather than faded: a run pushed past the capacity
        // is in the back layer, where fog has already taken its colour.
        if (node) kit.release(node);
        kept.delete(id);
      }
      nodes = drawn.map((spec) => {
        const existing = kept.get(spec.id);
        if (existing) {
          existing.spec = spec;
          // From wherever it is right now, so a poll that lands mid-slide
          // does not jump.
          existing.slideOrigin =
            existing.slideFrom >= 0
              ? {
                  x: existing.group.position.x,
                  y: existing.group.position.y,
                  z: existing.group.position.z,
                }
              : null;
          existing.slotFrom = existing.slotTo;
          existing.slotTo = spec.index;
          existing.slideFrom = elapsedNow;
          return existing;
        }
        const node = add(spec);
        place(node, spec.index);
        node.arriveFrom = elapsedNow;
        snapSpecimen(node, 0, 0);
        return node;
      });
    }

    // A gate per layer that holds a run, and none for one that does not.
    const occupied = Array.from({ length: LAYER_COUNT }, () => false);
    for (const spec of drawn) occupied[layerOf(spec.index).layer] = true;
    room.setOccupied(occupied);

    sparseTarget = sparseness(drawn.length);
    if (options.reducedMotion) sparse = sparseTarget;
    applyFocus();
    // Nothing is animating under reduced motion, so a change has to be drawn on
    // the spot or the canvas keeps showing the previous record.
    if (frame === 0) renderOnce();
  }

  /** How far a node is along its slide, 0 to 1. 1 at rest. */
  function slideT(node: SpecimenNode): number {
    if (node.slideFrom < 0) return 1;
    return slideProgress(node.slideFrom, elapsedNow, SLIDE_SECONDS);
  }

  /** Hovered, or picked and still marked in the record below. */
  function litId(): string | null {
    return focus ?? selection;
  }

  /**
   * Focus is a scale change and not a colour change: recolouring would break
   * the one rule the chamber keeps, that a specimen's colour is its verdict.
   *
   * It sets targets now rather than writing scales. `draw` eases toward them,
   * which is the difference between an instrument responding and one switching.
   */
  function applyFocus(): void {
    // Only a run the chamber is actually drawing dims the rest of it. The
    // record lists every run and the chamber holds the newest `capacity`, so
    // hovering a row past that end would otherwise fade every specimen to pick
    // out none of them.
    const id = litId();
    const drawn = id !== null && nodes.some((node) => node.spec.id === id);
    for (const node of nodes) {
      const on = drawn && id === node.spec.id;
      focusTargets.set(node.spec.id, { focus: on ? 1 : 0, dim: drawn && !on ? 1 : 0 });
      if (options.reducedMotion) snapSpecimen(node, on ? 1 : 0, drawn && !on ? 1 : 0);
    }
  }

  const focusTargets = new Map<string, { focus: number; dim: number }>();

  function setFocus(id: string | null): void {
    if (focus === id) return;
    focus = id;
    applyFocus();
    if (frame === 0) renderOnce();
  }

  function setSelection(id: string | null): void {
    if (selection === id) return;
    selection = id;
    applyFocus();
    if (frame === 0) renderOnce();
  }

  // --- interaction ----------------------------------------------------------

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let hovered: string | null = null;
  let dragging = false;
  let dragFrom: { x: number; y: number } | null = null;
  let yaw = 0;
  let pitch = 0;
  /** Where the pointer is over the hero, for parallax. Zero once it leaves. */
  let parallaxX = 0;
  let parallaxY = 0;

  function pick(event: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // The pick sphere round each system, not the core: the core is a tenth of
    // a unit across, and a hover that had to find it would find nothing.
    const hits = raycaster.intersectObjects(
      nodes.map((node) => node.pick),
      false,
    );
    const first = hits[0]?.object;
    return nodes.find((node) => node.pick === first)?.spec.id ?? null;
  }

  function onPointerMove(event: PointerEvent): void {
    if (dragging && dragFrom) {
      const rect = canvas.getBoundingClientRect();
      yaw = clamp(((event.clientX - dragFrom.x) / rect.width) * 1.4, -YAW_LIMIT, YAW_LIMIT);
      pitch = clamp(((event.clientY - dragFrom.y) / rect.height) * 0.9, -PITCH_LIMIT, PITCH_LIMIT);
      if (options.reducedMotion) renderOnce();
      return;
    }
    const id = pick(event);
    canvas.style.cursor = id ? "pointer" : "default";
    if (id !== hovered) {
      hovered = id;
      onHover(id);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    dragFrom = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDrag =
      dragFrom !== null && Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y) > 4;
    dragging = false;
    dragFrom = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    // A drag that ends over a specimen is a drag, not a click on it.
    if (wasDrag) return;
    // Null and not "nothing happened": a click on the empty volume is how a
    // reader puts the record back, and the component needs to hear it.
    onSelect(pick(event));
  }

  function onPointerLeave(): void {
    dragging = false;
    dragFrom = null;
    if (hovered !== null) {
      hovered = null;
      onHover(null);
    }
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  function setPointer(x: number | null, y: number | null): void {
    parallaxX = x === null ? 0 : clamp(x, -1, 1);
    parallaxY = y === null ? 0 : clamp(y, -1, 1);
  }

  // --- the loop -------------------------------------------------------------

  let frame = 0;
  let startedAt = 0;
  let lastElapsed = 0;
  /** Elapsed seconds at which the current sweep began. Negative means none yet. */
  let sweepFrom = -1;
  let sweepSeconds = SWEEP_MIN_SECONDS;
  let elapsedNow = 0;

  function pulse(intervalMs: number): void {
    sweepSeconds = clamp(intervalMs / 1000, SWEEP_MIN_SECONDS, SWEEP_MAX_SECONDS);
    sweepFrom = elapsedNow;
  }

  function draw(elapsed: number, dt: number): void {
    elapsedNow = elapsed;

    // Three contributions to one swing, so the volume answers the pointer,
    // answers a drag, and keeps moving when it is answering neither. Parallax
    // is what buys depth from a scene with no lights in it.
    const drift = cameraDrift(elapsed, options.reducedMotion);
    const totalYaw = clamp(yaw + parallaxX * 0.08 + drift.yaw, -YAW_LIMIT, YAW_LIMIT);
    const totalPitch = clamp(pitch + parallaxY * 0.05 + drift.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    sparse = options.reducedMotion ? sparseTarget : approach(sparse, sparseTarget, 0.02, dt);
    const placement = cameraPlacement({
      sparse,
      yaw: totalYaw,
      pitch: totalPitch,
      aspect: camera.aspect,
    });
    camera.position.set(placement.x, placement.y, placement.z);
    camera.lookAt(placement.aimX, placement.aimY, placement.aimZ);

    // The sweep is the poll. It leaves the back layer when data lands and
    // reaches the front as the next request is due, so a busy board sweeps
    // every five seconds and a quiet one crawls once every thirty.
    const phase = options.reducedMotion ? null : sweepPhase(elapsed, sweepFrom, sweepSeconds);
    const plane = phase === null ? null : sweepZ(phase);
    room.setSweep(plane);
    atmosphere.setSweep(plane);
    atmosphere.update(elapsed, options.reducedMotion);

    const lit = litId();
    for (const node of nodes) {
      // Slot, which the advance animation walks between.
      const t = slideT(node);
      if (node.slideFrom >= 0 && t >= 1) {
        node.slideFrom = -1;
        node.slideOrigin = null;
        node.slotFrom = node.slotTo;
      }

      // Arrival: in front of its slot, small and clear, easing into place.
      let arrivalScale = 1;
      let arrivalOpacity = 1;
      let lead = 0;
      if (node.arriveFrom >= 0) {
        const a = slideProgress(node.arriveFrom, elapsed, ARRIVE_SECONDS);
        const curve = arrivalCurve(a);
        arrivalScale = curve.scale;
        arrivalOpacity = curve.opacity;
        lead = curve.lead;
        if (a >= 1) node.arriveFrom = -1;
      }
      seat(node, t, lead);

      const target = focusTargets.get(node.spec.id) ?? { focus: 0, dim: 0 };
      node.focusAmount = options.reducedMotion
        ? target.focus
        : approach(node.focusAmount, target.focus, FOCUS_RATE, dt);
      node.dimAmount = options.reducedMotion
        ? target.dim
        : approach(node.dimAmount, target.dim, FOCUS_RATE, dt);

      // Read against the run's own depth: the plane lights a layer at a time,
      // and a run sliding between two layers is lit for wherever it is.
      const read = plane === null ? 0 : readStrength(plane, node.group.position.z);
      applySpecimenFrame(node, {
        elapsed,
        reducedMotion: options.reducedMotion,
        camera,
        focus: node.focusAmount,
        dim: node.dimAmount,
        read,
        arrivalScale,
        arrivalOpacity,
      });
      if (lit === node.spec.id) anchorOn(node);
    }
    if (lit === null || !nodes.some((node) => node.spec.id === lit)) anchorOn(null);

    post.render(dt);
  }

  const anchorPoint = new Vector3();
  let anchored = false;

  /**
   * Project the lit specimen onto the canvas, so the callout can sit beside the
   * thing it names rather than in a corner. This is what makes a hover on a
   * record row point at a specimen and not merely dim the others.
   */
  function anchorOn(node: SpecimenNode | null): void {
    if (!node) {
      if (!anchored) return;
      anchored = false;
      options.onAnchor(null, null);
      return;
    }
    anchorPoint.set(0, 0.12, 0);
    node.group.localToWorld(anchorPoint);
    anchorPoint.project(camera);
    anchored = true;
    options.onAnchor(
      ((anchorPoint.x + 1) / 2) * viewport.width,
      ((1 - anchorPoint.y) / 2) * viewport.height,
    );
  }

  function renderOnce(): void {
    // Zero delta, which every pass and every motion has a defined value for:
    // the grain does not advance, the stars sit at their seeded field, the
    // drift is exactly zero. The same frame every time, with the whole pipeline.
    draw(elapsedNow, 0);
  }

  function tick(now: number): void {
    if (startedAt === 0) startedAt = now;
    const elapsed = (now - startedAt) / 1000;
    // Clamped: a tab that was throttled hands back a delta of many seconds, and
    // an exponential approach over it would snap rather than ease.
    const dt = Math.min(0.05, Math.max(0, elapsed - lastElapsed));
    lastElapsed = elapsed;
    draw(elapsed, dt);
    frame = requestAnimationFrame(tick);
  }

  function start(): void {
    if (options.reducedMotion) {
      renderOnce();
      return;
    }
    if (frame !== 0) return;
    frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (frame === 0) return;
    cancelAnimationFrame(frame);
    frame = 0;
    // So a paused-then-resumed loop does not jump the sweep forward by however
    // long the tab was in the background. The sweep is dropped with it: the
    // poll it was drawing did not happen while the tab was hidden.
    startedAt = 0;
    lastElapsed = 0;
    elapsedNow = 0;
    sweepFrom = -1;
  }

  function resize(width: number, height: number): void {
    const ratio = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 1.5);
    viewport.width = width;
    viewport.height = height;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    post.setSize(width, height, ratio);
    // CSS pixels, not device pixels: that is the space `LineMaterial` measures
    // its width in, so a 1.1px gate is 1.1px on any display.
    room.setResolution(width, height);
    atmosphere.setFrame(FOV, camera.aspect);
    if (options.reducedMotion || frame === 0) renderOnce();
  }

  function dispose(): void {
    stop();
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    clearNodes();
    kit.dispose();
    room.dispose();
    atmosphere.dispose();
    post.dispose();
    renderer.dispose();
  }

  return {
    setSpecimens,
    setFocus,
    setSelection,
    pulse,
    setPointer,
    resize,
    renderOnce,
    start,
    stop,
    dispose,
  };
}
