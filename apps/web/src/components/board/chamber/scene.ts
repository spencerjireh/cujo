/**
 * The chamber: a sealed volume with the run history hanging inside it.
 *
 * Imperative and framework-free on purpose. React owns when this exists and
 * what data it holds; everything about the scene — the box, the chain, the
 * specimens, the sweep — lives here, so the component is a lifecycle and not a
 * renderer.
 *
 * Four rules make this a diagram rather than an ornament:
 *
 * - **Nothing in here exists that is not a measurement.** The newest rule, and
 *   the one that decides the rest. The floor ticks say which slots hold a run,
 *   the wall ribs are the axis those slots sit on, the chain ends where the
 *   record ends, and the sweep is the board re-reading the API. Anything that
 *   could be moved, resized or recoloured without a fact changing does not
 *   belong in the volume.
 * - **Depth is time.** The newest run is nearest, the oldest recedes into the
 *   fog. Nothing is placed for composition.
 * - **Every specimen is drawn from its own digest.** Arm lengths are check
 *   durations on one shared scale, arm colours are how each check ended, the
 *   core is the verdict at a size set by the worst thing the run found, and the
 *   marks on its drop line are the findings themselves. Two runs look alike
 *   only if they ran alike.
 * - **The chain.** Cujo is a guard dog on a chain (brand/brand.md), and the
 *   chain is what makes a row of specimens a record instead of a scatter.
 *
 * Materials are unlit on purpose: this is an instrument face, not a lit room,
 * so there are no lights to tune and nothing costs a shadow pass. Depth is
 * bought with the things a technical drawing uses instead — recession, fog,
 * a floor tether under every specimen, and parallax between the floor and the
 * walls as the camera drifts.
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
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

/**
 * The volume, in scene units. Depth is the axis the record runs along, and it
 * is long: the recession from the near face to the fog is the only thing that
 * makes twenty-four runs read as a series rather than a stack.
 */
const BOX = { width: 3.9, height: 2.3, depth: 17 };
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
const SPACING = 0.58;
/** How far the front-most specimen sits from the open face. */
const FRONT_Z = 1.0;
/**
 * Longest arm a specimen draws, at `length: 1`. Sized against `SPACING`: an arm
 * longer than about half the gap and the near specimens overlap into a thicket
 * instead of reading as a series.
 */
const ARM_MAX = 0.3;
const ARM_THICKNESS = 0.02;
/** How near the sweep has to be for a specimen to light up. */
const SWEEP_REACH = 1.1;
/**
 * How long one sweep takes, clamped from the list query's own poll interval.
 * The floor is so a five-second poll is a pass and not a flash; the ceiling is
 * so a thirty-second one still finishes and gets out of the way.
 */
const SWEEP_MIN_SECONDS = 4;
const SWEEP_MAX_SECONDS = 22;
/** One ambient orbit, in seconds. Slow enough to be parallax and not motion. */
const DRIFT_SECONDS = 44;
const DRIFT_YAW = 0.045;
/** Below this many runs the camera comes in, so one run is not a distant dot. */
const SPARSE_BELOW = 5;

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

/** Reads a brand token off the document, so no hex literal lives in this file. */
function tokenColor(name: string, fallback: string): Color {
  const raw =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(raw || fallback);
}

interface SpecimenArm {
  mesh: Mesh;
  /** Its measured length, which the running pulse oscillates around. */
  baseLength: number;
  dx: number;
  dy: number;
  running: boolean;
}

/**
 * A material and the opacity it returns to when nothing is dimmed.
 *
 * Carried rather than inferred, because the specimens are not all opaque: the
 * floor shadow is a smudge at 0.28 and resetting it to 1 would turn it into a
 * plate. The dim state has to be reversible without guessing.
 */
interface ToneMaterial {
  material: MeshBasicMaterial;
  base: number;
}

interface SpecimenNode {
  /** At the slot. Never scaled, so the rigging stays attached to the room. */
  group: Group;
  /** What focus and the sweep scale: the core, the arms, nothing else. */
  body: Group;
  core: Mesh;
  arms: SpecimenArm[];
  /** One per finding, strung on the drop line. Scaled individually on focus. */
  marks: Mesh[];
  /**
   * Only on a live run. Its opacity is written every frame, so it is kept out
   * of `materials` and dimmed through `dimmed` instead.
   */
  ring: Mesh | null;
  materials: ToneMaterial[];
  /** True while another specimen is lit and this one is not. */
  dimmed: boolean;
  spec: Specimen;
}

/** How much of its colour a specimen keeps while another one is lit. */
const DIMMED = 0.45;

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
  /** In CSS pixels, which is the frame the callout is positioned in. */
  const viewport = { width: 1, height: 1 };

  const scene = new Scene();
  // The fog is the back wall. It does the work a horizon does in a photograph:
  // it says the record continues past what is drawn, rather than stopping.
  scene.fog = new Fog(chamberColor, 5.5, BOX.depth + 5);

  const camera = new PerspectiveCamera(30, 1, 0.1, 60);
  /** Where the camera stands with a full record. `dolly` pulls it in when sparse. */
  const home = { x: -1.45, y: 1.28, z: 5.6 };
  /**
   * Where the camera points. Down the record, not at the middle of the box, and
   * far enough down it that the recession stays in the right half of the frame
   * rather than climbing into the headline.
   */
  const aim = { x: RECORD_X - 0.2, y: -0.05, z: -4.8 };
  /** 0 with a full record, 1 with one run. Set by `setSpecimens`. */
  let sparse = 0;
  camera.position.set(home.x, home.y, home.z);
  camera.lookAt(aim.x, aim.y, aim.z);

  // --- the room -------------------------------------------------------------

  const shellZ = FRONT_Z - BOX.depth / 2 + 0.6;
  const backZ = shellZ - BOX.depth / 2;
  const floorY = -BOX.height / 2;
  /** Every slot the volume has room for, front to back. The time axis. */
  const slotCount = Math.max(1, Math.floor(BOX.depth / SPACING));
  const slotZ = (index: number) => FRONT_Z - index * SPACING;

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

  // The rails and the ribs are the ruler: two rails down the length of the
  // volume, and one vertical on each side wall at every slot the record could
  // occupy. Reading the ribs against the floor as the camera drifts is what
  // makes the box a volume rather than a rectangle with lines in it.
  // Brighter than the token for the same reason the shell is: at the token
  // value the ruler is three shades off the background and an empty chamber
  // reads as a black rectangle rather than as an instrument holding nothing.
  const rails = railsAndRibs(lineColor.clone().multiplyScalar(3.6), slotCount, slotZ);
  scene.add(rails);

  // Occupancy: one cross-tick per slot that actually holds a run, brighter than
  // the ruler behind it. Rebuilt whenever the record changes, which is why it
  // is held in a `let` and not built beside the rails.
  let ticks: LineSegments | null = null;
  /**
   * Set before `dispose()` frees the room. `rebuildRoom` puts a chain back on
   * an empty board, which is right while the scene is alive and is a leak on
   * the way out.
   */
  let disposing = false;
  const tickMaterial = new LineBasicMaterial({
    color: lineColor.clone().multiplyScalar(5),
    fog: true,
  });

  // The chain: one taut line from the open face to the last run on it, with
  // every specimen hanging off it. Its length is the record's length, so a
  // board with three runs has a short chain and does not pretend otherwise.
  const chainY = BOX.height / 2 - 0.22;
  const chainMaterial = new LineBasicMaterial({
    color: lineColor.clone().multiplyScalar(2.4),
    fog: true,
  });
  let chain: LineSegments | null = null;

  // The scan plane, drawn as a rectangle of hairlines rather than a filled
  // quad: it reads as a measurement passing through, not as a wall.
  const sweep = new LineSegments(
    new EdgesGeometry(new BoxGeometry(BOX.width * 0.96, BOX.height * 0.96, 0.001)),
    new LineBasicMaterial({ color: amber, transparent: true, opacity: 0.3, fog: true }),
  );
  sweep.position.x = RECORD_X;
  sweep.visible = false;
  scene.add(sweep);

  // --- specimens ------------------------------------------------------------

  const armGeometry = new BoxGeometry(1, ARM_THICKNESS, ARM_THICKNESS);
  const coreGeometry = new OctahedronGeometry(0.042, 0);
  const markGeometry = new BoxGeometry(0.03, 0.03, 0.03);
  const ringGeometry = new RingGeometry(0.085, 0.1, 28);
  const shadowGeometry = new PlaneGeometry(0.09, 0.09);
  const dropMaterial = new LineBasicMaterial({ color: lineColor, fog: true });

  const specimens = new Group();
  scene.add(specimens);
  let nodes: SpecimenNode[] = [];
  let focus: string | null = null;
  let selection: string | null = null;

  function clearNodes(): void {
    for (const node of nodes) {
      specimens.remove(node.group);
      for (const entry of node.materials) entry.material.dispose();
      if (node.ring) (node.ring.material as MeshBasicMaterial).dispose();
      node.group.traverse((child) => {
        if (child instanceof LineSegments) child.geometry.dispose();
      });
    }
    nodes = [];
  }

  function build(spec: Specimen): SpecimenNode {
    const group = new Group();
    group.position.set(RECORD_X, RECORD_Y, slotZ(spec.index));
    const materials: ToneMaterial[] = [];
    const toneColor = toneColors.get(spec.tone) ?? lineColor;

    // Hangs off the chain, so the line above is load-bearing rather than
    // decorative. On the group and not the body: focus scales the body, and a
    // drop line that grew with it would overshoot the chain it hangs from.
    group.add(new LineSegments(lineGeometry([0, chainY - RECORD_Y, 0, 0, 0, 0]), dropMaterial));

    // The tether to the floor, and the shadow it lands on. Together they are
    // the strongest depth cue available without a light in the room, and both
    // are readings: the foot of the tether is the run's slot on the time axis.
    const floorLocalY = floorY - RECORD_Y;
    group.add(new LineSegments(lineGeometry([0, 0, 0, 0, floorLocalY, 0]), dropMaterial));
    const shadowMaterial = new MeshBasicMaterial({
      color: toneColor,
      fog: true,
      transparent: true,
      opacity: 0.28,
    });
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = floorLocalY;
    group.add(shadow);
    materials.push({ material: shadowMaterial, base: 0.28 });

    // One mark per finding, worst nearest the core, strung up the drop line.
    // What the run produced, hanging off what produced it.
    const marks: Mesh[] = [];
    spec.marks.forEach((mark, i) => {
      const material = new MeshBasicMaterial({
        color: toneColors.get(mark.tone) ?? lineColor,
        fog: true,
      });
      const mesh = new Mesh(markGeometry, material);
      mesh.position.y = 0.085 + i * 0.055;
      group.add(mesh);
      marks.push(mesh);
      materials.push({ material, base: 1 });
    });

    const body = new Group();
    group.add(body);

    const coreMaterial = new MeshBasicMaterial({ color: toneColor, fog: true });
    const core = new Mesh(coreGeometry, coreMaterial);
    // The worst thing the run found, as size. Fog takes the colour out of a
    // distant specimen long before it takes the silhouette, so a dangerous run
    // at the back of the volume still reads as one.
    core.scale.setScalar(spec.coreScale);
    body.add(core);
    materials.push({ material: coreMaterial, base: 1 });

    const arms: SpecimenArm[] = [];
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
      const [dx, dy] = direction;
      const baseLength = bar.length * ARM_MAX;
      placeArm(arm, baseLength, dx, dy);
      body.add(arm);
      arms.push({ mesh: arm, baseLength, dx, dy, running: bar.outcome === "running" });
      materials.push({ material, base: 1 });
    });

    // A live run gets a ring that expands and fades once a second. Amber,
    // which brand.md allows on exactly the things that are waiting — and a run
    // still in the sandbox is the board's other one.
    let ring: Mesh | null = null;
    if (spec.live) {
      const ringMaterial = new MeshBasicMaterial({
        color: amber,
        fog: true,
        transparent: true,
        opacity: 0,
      });
      ring = new Mesh(ringGeometry, ringMaterial);
      group.add(ring);
    }

    specimens.add(group);
    return { group, body, core, arms, marks, ring, materials, dimmed: false, spec };
  }

  /** An arm is a box scaled along x and swung to its diagonal from the core. */
  function placeArm(arm: Mesh, length: number, dx: number, dy: number): void {
    const axis = Math.SQRT1_2;
    arm.scale.x = length;
    arm.rotation.z = Math.atan2(dy, dx);
    arm.position.set((dx * axis * length) / 2, (dy * axis * length) / 2, 0);
  }

  /**
   * The floor's occupancy ticks and the chain's length, both of which are facts
   * about the record and so must be rebuilt when the record changes.
   */
  function rebuildRoom(count: number): void {
    if (ticks) {
      scene.remove(ticks);
      ticks.geometry.dispose();
      ticks = null;
    }
    if (chain) {
      scene.remove(chain);
      chain.geometry.dispose();
      chain = null;
    }
    if (disposing) return;

    // One tick per occupied slot, and none at all on an empty board: the floor
    // says where the record is, so with no record it says nothing.
    if (count > 0) {
      const points: number[] = [];
      const half = BOX.width / 2;
      for (let i = 0; i < count; i += 1) {
        points.push(RECORD_X - half, floorY, slotZ(i), RECORD_X + half, floorY, slotZ(i));
      }
      ticks = new LineSegments(lineGeometry(points), tickMaterial);
      scene.add(ticks);
    }

    // The chain ends where the record ends, so its length is the record's
    // length — except on an empty board, where there is no record to bound it
    // and the chain runs the volume. The instrument is there and holding
    // nothing, which is a different picture from an instrument that is absent.
    const back = count > 0 ? slotZ(count - 1) - 0.35 : backZ + 0.4;
    chain = new LineSegments(
      lineGeometry([RECORD_X, chainY, FRONT_Z + 0.6, RECORD_X, chainY, back]),
      chainMaterial,
    );
    scene.add(chain);
  }

  function setSpecimens(next: Specimen[]): void {
    clearNodes();
    const drawn = next.slice(0, options.capacity);
    nodes = drawn.map(build);
    rebuildRoom(drawn.length);
    // A record of one or two runs in a volume built for twenty-four is a dot at
    // the end of an empty room. The camera comes in so the volume frames what
    // is actually in it.
    sparse =
      drawn.length === 0 ? 1 : Math.max(0, (SPARSE_BELOW - drawn.length) / (SPARSE_BELOW - 1));
    applyFocus();
    // Nothing is animating under reduced motion, so a change has to be drawn
    // on the spot or the canvas keeps showing the previous record.
    if (frame === 0) renderOnce();
  }

  /** Hovered, or picked and still marked in the record below. */
  function litId(): string | null {
    return focus ?? selection;
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
    const id = litId();
    const drawn = id !== null && nodes.some((node) => node.spec.id === id);
    for (const node of nodes) {
      const on = drawn && id === node.spec.id;
      node.dimmed = drawn && !on;
      node.body.scale.setScalar(on ? 1.55 : 1);
      for (const mark of node.marks) mark.scale.setScalar(on ? 1.55 : 1);
      for (const { material, base } of node.materials) {
        material.opacity = node.dimmed ? base * DIMMED : base;
        // Left on once set: turning it back off mid-session would make an
        // already-transparent shadow opaque, and the flag costs nothing.
        material.transparent = material.transparent || node.dimmed;
      }
    }
  }

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
  /** Elapsed seconds at which the current sweep began. Negative means none yet. */
  let sweepFrom = -1;
  let sweepSeconds = SWEEP_MIN_SECONDS;
  let elapsedNow = 0;

  function pulse(intervalMs: number): void {
    sweepSeconds = clamp(intervalMs / 1000, SWEEP_MIN_SECONDS, SWEEP_MAX_SECONDS);
    sweepFrom = elapsedNow;
  }

  function draw(elapsed: number): void {
    elapsedNow = elapsed;
    // Three contributions to one swing, so the volume answers the pointer,
    // answers a drag, and keeps moving when it is answering neither. Parallax
    // is what buys depth from a scene with no lights in it.
    const drift = options.reducedMotion
      ? 0
      : Math.sin((elapsed / DRIFT_SECONDS) * Math.PI * 2) * DRIFT_YAW;
    const totalYaw = clamp(yaw + parallaxX * 0.08 + drift, -YAW_LIMIT, YAW_LIMIT);
    const totalPitch = clamp(pitch + parallaxY * 0.05, -PITCH_LIMIT, PITCH_LIMIT);
    // Sparse records are framed closer, and the aim comes with the camera so
    // the near end of a three-run chain does not slide out of shot.
    const standZ = home.z - sparse * 2.1;
    const aimZ = aim.z + sparse * 2.4;

    const swing = 0.55;
    camera.position.x = home.x + Math.sin(totalYaw) * standZ * swing;
    camera.position.y = home.y + totalPitch * 1.6;
    camera.position.z = standZ * Math.cos(totalYaw * swing);
    camera.lookAt(aim.x, aim.y, aimZ);

    // The sweep is the poll. It leaves the back wall when data lands and
    // reaches the front as the next request is due, so a busy board sweeps
    // every five seconds and a quiet one crawls once every thirty.
    let sweepZ = Number.NEGATIVE_INFINITY;
    if (options.reducedMotion || sweepFrom < 0) {
      sweep.visible = false;
    } else {
      const phase = (elapsed - sweepFrom) / sweepSeconds;
      sweep.visible = phase <= 1;
      if (sweep.visible) {
        sweepZ = backZ + (FRONT_Z + 0.8 - backZ) * phase;
        sweep.position.z = sweepZ;
      }
    }

    const lit = litId();
    for (const node of nodes) {
      const focused = lit === node.spec.id;
      let lift = 1;
      if (!options.reducedMotion) {
        // The sweep reading a specimen, and a live run breathing on its own.
        // Two sources, one scale, so nothing ever pulses out of phase with the
        // instrument that is supposed to be driving it.
        const near =
          sweepZ === Number.NEGATIVE_INFINITY
            ? 0
            : Math.max(0, 1 - Math.abs(sweepZ - node.group.position.z) / SWEEP_REACH);
        const alive = node.spec.live ? 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 2.4)) : 0;
        lift = 1 + near * 0.45 + alive;

        // A check still in the sandbox has no measured length, so its arm
        // reaches and retracts around the unmeasured one rather than sitting
        // at a length it never reported.
        for (const arm of node.arms) {
          if (!arm.running) continue;
          const reach = arm.baseLength * (0.82 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 3.1)));
          placeArm(arm.mesh, reach, arm.dx, arm.dy);
        }

        // The ring is one second of expansion and fade, restarting: a pulse
        // leaving a run that is still executing.
        if (node.ring) {
          const phase = (elapsed % 1.6) / 1.6;
          node.ring.scale.setScalar(0.7 + phase * 1.9);
          const material = node.ring.material as MeshBasicMaterial;
          material.opacity = 0.5 * (1 - phase) * (node.dimmed ? DIMMED : 1);
          node.ring.lookAt(camera.position);
        }
      }
      node.body.scale.setScalar((focused ? 1.55 : 1) * lift);
      if (focused) anchorOn(node);
    }
    if (lit === null || !nodes.some((node) => node.spec.id === lit)) anchorOn(null);

    renderer.render(scene, camera);
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
    draw(elapsedNow);
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
    // long the tab was in the background. The sweep is dropped with it: the
    // poll it was drawing did not happen while the tab was hidden.
    startedAt = 0;
    elapsedNow = 0;
    sweepFrom = -1;
  }

  function resize(width: number, height: number): void {
    const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 1.5);
    viewport.width = width;
    viewport.height = height;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    if (options.reducedMotion || frame === 0) renderOnce();
  }

  function dispose(): void {
    disposing = true;
    stop();
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    clearNodes();
    rebuildRoom(0);
    armGeometry.dispose();
    coreGeometry.dispose();
    markGeometry.dispose();
    ringGeometry.dispose();
    shadowGeometry.dispose();
    dropMaterial.dispose();
    tickMaterial.dispose();
    chainMaterial.dispose();
    for (const object of [shell, sweep, rails]) {
      object.geometry.dispose();
      (object.material as LineBasicMaterial).dispose();
    }
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function lineGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  return geometry;
}

/**
 * The ruler: rails running the length of the volume, and one vertical rib on
 * each side wall at every slot a run could occupy.
 *
 * `GridHelper` would draw a square grid centred on the origin, which is a
 * different room from this one. The ribs are the reason for the rest: with only
 * a floor, a drift of four hundredths of a radian changes nothing you can see,
 * and the box stays a flat rectangle with lines in it.
 */
function railsAndRibs(
  color: Color,
  slotCount: number,
  slotZ: (index: number) => number,
): LineSegments {
  const points: number[] = [];
  const halfW = BOX.width / 2;
  const halfH = BOX.height / 2;
  const y = -halfH;
  const front = slotZ(0) + 0.4;
  const back = slotZ(slotCount - 1);
  for (let i = -2; i <= 2; i += 1) {
    const x = RECORD_X + (i / 2) * halfW;
    points.push(x, y, back, x, y, front);
  }
  for (let i = 0; i < slotCount; i += 1) {
    const z = slotZ(i);
    points.push(RECORD_X - halfW, -halfH, z, RECORD_X - halfW, halfH, z);
    points.push(RECORD_X + halfW, -halfH, z, RECORD_X + halfW, halfH, z);
  }
  return new LineSegments(
    lineGeometry(points),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.55, fog: true }),
  );
}
