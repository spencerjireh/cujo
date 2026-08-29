/**
 * The chamber: a sealed volume with the run history hanging inside it.
 *
 * Imperative and framework-free on purpose. React owns when this exists and
 * what data it holds; everything about the scene — the box, the chain, the
 * specimens, the sweep — lives here, so the component is a lifecycle and not a
 * renderer.
 *
 * Three things make this a diagram rather than an ornament:
 *
 * - **Depth is time.** The newest run is nearest, the oldest recedes into the
 *   fog. Nothing is placed for composition.
 * - **Every specimen is drawn from its own digest.** Arm lengths are check
 *   durations on one shared scale, arm colours are how each check ended, the
 *   core is the verdict. Two runs look alike only if they ran alike.
 * - **The chain.** Cujo is a guard dog on a chain (brand/brand.md), and the
 *   chain is what makes a row of specimens a record instead of a scatter.
 *
 * Materials are unlit on purpose: this is an instrument face, not a lit room,
 * so there are no lights to tune and nothing costs a shadow pass.
 */

import type { Specimen } from "@/lib/board/specimen";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";

/** The volume, in scene units. Depth is the axis the record runs along. */
const BOX = { width: 3.9, height: 2.3, depth: 12.4 };
/**
 * The record sits right of centre, and the camera stands left of it looking
 * across. A row placed on the camera's own axis converges straight onto the
 * vanishing point and the whole history piles into one knot two seconds after
 * you look at it; offset, it recedes diagonally and every specimen keeps its
 * own piece of the frame. The offset is also what leaves the left of the
 * viewport clear, which is where the headline goes.
 */
const RECORD_X = 1.15;
/** Height of the record inside the volume: the specimens hang, so above centre. */
const RECORD_Y = 0.1;
/** Distance between one run and the next, front to back. */
const SPACING = 0.55;
/** How far the front-most specimen sits from the open face. */
const FRONT_Z = 1.0;
/**
 * Longest arm a specimen draws, at `length: 1`. Sized against `SPACING`: an arm
 * longer than about half the gap and the near specimens overlap into a thicket
 * instead of reading as a series.
 */
const ARM_MAX = 0.3;
const ARM_THICKNESS = 0.02;
/** One sweep of the scan plane, back to front, in seconds. */
const SWEEP_SECONDS = 11;
/** How near the sweep has to be for a specimen to light up. */
const SWEEP_REACH = 1.1;

export interface ChamberHandle {
  /** Replace the record. Cheap enough to call on every poll. */
  setSpecimens(next: Specimen[]): void;
  /** Highlight one run, or none. Driven by the record's hover as well as ours. */
  setFocus(id: string | null): void;
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
  onSelect(id: string): void;
}

/** Reads a brand token off the document, so no hex literal lives in this file. */
function tokenColor(name: string, fallback: string): Color {
  const raw =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(raw || fallback);
}

interface SpecimenNode {
  group: Group;
  core: Mesh;
  arms: Mesh[];
  materials: MeshBasicMaterial[];
  spec: Specimen;
}

export function createChamber(options: ChamberOptions): ChamberHandle {
  const { canvas, onHover, onSelect } = options;

  const chamberColor = tokenColor("--chamber", "#0a0908");
  const lineColor = tokenColor("--chamber-line", "#24211c");
  const amber = tokenColor("--chamber-amber", "#f2a900");
  const toneColors = new Map<string, Color>(
    Object.entries(TONE_CHAMBER_VAR).map(([tone, variable]) => [
      tone,
      tokenColor(variable, "#958d82"),
    ]),
  );

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(chamberColor, 1);

  const scene = new Scene();
  // The fog is the back wall. It does the work a horizon does in a photograph:
  // it says the record continues past what is drawn, rather than stopping.
  scene.fog = new Fog(chamberColor, 6.5, BOX.depth + 2.5);

  const camera = new PerspectiveCamera(30, 1, 0.1, 60);
  const home = { x: -0.9, y: 1.5, z: 5.4 };
  /** Where the camera points. Down the record, not at the middle of the box. */
  const aim = { x: RECORD_X - 0.15, y: -0.05, z: -3.2 };
  camera.position.set(home.x, home.y, home.z);
  camera.lookAt(aim.x, aim.y, aim.z);

  // --- the room -------------------------------------------------------------

  const shellZ = FRONT_Z - BOX.depth / 2 + 0.6;
  // Brighter than `--chamber-line` by design: a hairline at the token value is
  // three shades off the background and the volume stops reading as a room at
  // all. `LineBasicMaterial` cannot be thickened — `linewidth` is ignored on
  // every desktop driver — so the only lever is value.
  const shell = new LineSegments(
    new EdgesGeometry(new BoxGeometry(BOX.width, BOX.height, BOX.depth)),
    new LineBasicMaterial({ color: lineColor.clone().multiplyScalar(3.2), fog: true }),
  );
  shell.position.set(RECORD_X, 0, shellZ);
  scene.add(shell);
  // Held in a name rather than added inline: `dispose()` below has to free its
  // buffers and material, and an object only the scene graph refers to is one
  // nothing frees.
  const floor = floorGrid(shellZ, lineColor.clone().multiplyScalar(2.2));
  scene.add(floor);

  // The chain: one taut line down the length of the volume, with every
  // specimen hanging off it.
  const chainY = BOX.height / 2 - 0.22;
  const chain = new LineSegments(
    lineGeometry([RECORD_X, chainY, FRONT_Z + 0.6, RECORD_X, chainY, shellZ - BOX.depth / 2 + 0.2]),
    new LineBasicMaterial({ color: lineColor.clone().multiplyScalar(2.4), fog: true }),
  );
  scene.add(chain);

  // The scan plane, drawn as a rectangle of hairlines rather than a filled
  // quad: it reads as a measurement passing through, not as a wall.
  const sweep = new LineSegments(
    new EdgesGeometry(new BoxGeometry(BOX.width * 0.96, BOX.height * 0.96, 0.001)),
    new LineBasicMaterial({ color: amber, transparent: true, opacity: 0.3, fog: true }),
  );
  sweep.position.x = RECORD_X;
  scene.add(sweep);

  // --- specimens ------------------------------------------------------------

  const armGeometry = new BoxGeometry(1, ARM_THICKNESS, ARM_THICKNESS);
  const coreGeometry = new OctahedronGeometry(0.042, 0);
  const dropMaterial = new LineBasicMaterial({ color: lineColor, fog: true });

  const specimens = new Group();
  scene.add(specimens);
  let nodes: SpecimenNode[] = [];
  let focus: string | null = null;

  function clearNodes(): void {
    for (const node of nodes) {
      specimens.remove(node.group);
      for (const material of node.materials) material.dispose();
      for (const child of node.group.children) {
        if (child instanceof LineSegments) child.geometry.dispose();
      }
    }
    nodes = [];
  }

  function build(spec: Specimen): SpecimenNode {
    const group = new Group();
    group.position.set(RECORD_X, RECORD_Y, FRONT_Z - spec.index * SPACING);

    const coreMaterial = new MeshBasicMaterial({
      color: toneColors.get(spec.tone) ?? lineColor,
      fog: true,
    });
    const core = new Mesh(coreGeometry, coreMaterial);
    group.add(core);

    // Hangs off the chain, so the line above is load-bearing rather than
    // decorative.
    group.add(new LineSegments(lineGeometry([0, chainY - RECORD_Y, 0, 0, 0, 0]), dropMaterial));

    const materials = [coreMaterial];
    const arms: Mesh[] = [];
    // Four diagonals in the plane facing the camera, in CHECK_NAMES order, so
    // the same check is always the same arm and a lopsided specimen is
    // readable across the whole chamber.
    const directions = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ] as const;

    spec.bars.forEach((bar, i) => {
      // Length zero is a check that never appeared. Drawing a stub would claim
      // it ran briefly, so nothing is drawn at all and the gap is the fact.
      if (bar.length <= 0) return;
      const direction = directions[i];
      if (!direction) return;
      const material = new MeshBasicMaterial({
        color: toneColors.get(bar.tone) ?? lineColor,
        fog: true,
      });
      const arm = new Mesh(armGeometry, material);
      const length = bar.length * ARM_MAX;
      const [dx, dy] = direction;
      const axis = Math.SQRT1_2;
      arm.scale.x = length;
      arm.rotation.z = Math.atan2(dy, dx);
      arm.position.set((dx * axis * length) / 2, (dy * axis * length) / 2, 0);
      group.add(arm);
      arms.push(arm);
      materials.push(material);
    });

    specimens.add(group);
    return { group, core, arms, materials, spec };
  }

  function setSpecimens(next: Specimen[]): void {
    clearNodes();
    nodes = next.slice(0, options.capacity).map(build);
    applyFocus();
    // Nothing is animating under reduced motion, so a change has to be drawn
    // on the spot or the canvas keeps showing the previous record.
    if (frame === 0) renderOnce();
  }

  /**
   * Focus is a scale change and not a colour change: recolouring would break
   * the one rule the chamber keeps, that a specimen's colour is its verdict.
   */
  function applyFocus(): void {
    // Only a run the chamber is actually drawing dims the rest of it. The
    // record lists every run and the chamber holds the newest `capacity`, so
    // hovering a row past that end would otherwise fade every specimen to
    // pick out none of them.
    const drawn = focus !== null && nodes.some((node) => node.spec.id === focus);
    for (const node of nodes) {
      const on = drawn && focus === node.spec.id;
      node.group.scale.setScalar(on ? 1.55 : 1);
      for (const material of node.materials) {
        material.opacity = drawn && !on ? 0.45 : 1;
        material.transparent = drawn;
      }
    }
  }

  function setFocus(id: string | null): void {
    if (focus === id) return;
    focus = id;
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
  /** How far the camera may be swung, in radians. A peek, not an orbit. */
  const YAW_LIMIT = 0.26;
  const PITCH_LIMIT = 0.14;

  function pick(event: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Cores only. The arms are thin and a run is picked by its verdict, which
    // is the part a pointer can actually land on.
    const hits = raycaster.intersectObjects(
      nodes.map((node) => node.core),
      false,
    );
    const first = hits[0]?.object;
    return nodes.find((node) => node.core === first)?.spec.id ?? null;
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
    const id = pick(event);
    if (id) onSelect(id);
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

  // --- the loop -------------------------------------------------------------

  let frame = 0;
  let startedAt = 0;

  function draw(elapsed: number): void {
    const swing = 0.55;
    camera.position.x = home.x + Math.sin(yaw) * home.z * swing;
    camera.position.y = home.y + pitch * 1.6;
    camera.position.z = home.z * Math.cos(yaw * swing);
    camera.lookAt(aim.x, aim.y, aim.z);

    const backZ = shellZ - BOX.depth / 2;
    if (options.reducedMotion) {
      sweep.visible = false;
    } else {
      const phase = (elapsed % SWEEP_SECONDS) / SWEEP_SECONDS;
      sweep.position.z = backZ + (FRONT_Z + 0.8 - backZ) * phase;
    }

    for (const node of nodes) {
      const focused = focus === node.spec.id;
      let lift = 1;
      if (!options.reducedMotion) {
        // The sweep reading a specimen, and a live run breathing on its own.
        // Two sources, one scale, so nothing ever pulses out of phase with the
        // instrument that is supposed to be driving it.
        const near = Math.max(
          0,
          1 - Math.abs(sweep.position.z - node.group.position.z) / SWEEP_REACH,
        );
        const alive = node.spec.live ? 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 2.4)) : 0;
        lift = 1 + near * 0.45 + alive;
      }
      node.group.scale.setScalar((focused ? 1.55 : 1) * lift);
    }

    renderer.render(scene, camera);
  }

  function renderOnce(): void {
    draw(0);
  }

  function tick(now: number): void {
    if (startedAt === 0) startedAt = now;
    draw((now - startedAt) / 1000);
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
    // long the tab was in the background.
    startedAt = 0;
  }

  function resize(width: number, height: number): void {
    const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    if (options.reducedMotion || frame === 0) renderOnce();
  }

  function dispose(): void {
    stop();
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    clearNodes();
    armGeometry.dispose();
    coreGeometry.dispose();
    dropMaterial.dispose();
    for (const object of [shell, chain, sweep, floor]) {
      object.geometry.dispose();
      (object.material as LineBasicMaterial).dispose();
    }
    renderer.dispose();
  }

  return { setSpecimens, setFocus, resize, renderOnce, start, stop, dispose };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function lineGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  return geometry;
}

/**
 * The floor, as rails running the length of the volume plus ticks across it.
 * `GridHelper` would draw a square grid centred on the origin, which is a
 * different room from this one.
 */
function floorGrid(centerZ: number, color: Color): LineSegments {
  const points: number[] = [];
  const halfW = BOX.width / 2;
  const halfD = BOX.depth / 2;
  const y = -BOX.height / 2;
  for (let i = -2; i <= 2; i += 1) {
    const x = RECORD_X + (i / 2) * halfW;
    points.push(x, y, centerZ - halfD, x, y, centerZ + halfD);
  }
  // One tick per run position, so the floor is the time axis and not wallpaper.
  for (let z = centerZ + halfD; z >= centerZ - halfD; z -= SPACING) {
    points.push(RECORD_X - halfW, y, z, RECORD_X + halfW, y, z);
  }
  return new LineSegments(
    lineGeometry(points),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.55, fog: true }),
  );
}
