/**
 * A run, as geometry. The one part of the scene two scenes share.
 *
 * The chamber draws twenty-four of these hanging on a chain; the run page draws
 * exactly one, beside the pull request's title, with no room around it. They
 * have to be the same drawing — a specimen that means one thing on the board
 * and another on the run page would make the shape decorative — so the builder
 * is here and both callers use it.
 *
 * What separates the two is a rig, not a flag named after the caller. The board
 * passes a chain to hang from and a floor to land on; the run page passes
 * neither, and the two lines that reference a room are simply not drawn. That
 * is the whole seam: `build()` returns a detached `Group`, and whoever asked
 * for it decides what to add it to.
 *
 * Every rule about what a specimen *means* lives in `@/lib/board/specimen`,
 * which is pure and tested. This module only turns that into meshes.
 */

import { ARM_MAX, ARM_THICKNESS } from "@/lib/board/chamber-layout";
import type { Specimen } from "@/lib/board/specimen";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  CanvasTexture,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import type { ChamberPalette } from "./palette";

/** How much of its colour a specimen keeps while another one is lit. */
export const DIMMED = 0.45;

/**
 * What the specimen is hung on, which is the only thing the two scenes differ
 * by. Every field here is a fact about the room, so a scene with no room sets
 * them all to nothing and the builder draws a bare shape.
 */
export interface SpecimenRig {
  /** Local height of the drop line above the core. 0 draws none. */
  dropAbove: number;
  /** Local y of the floor under the core. Null draws no tether and no shadow. */
  tetherY: number | null;
  /** Findings strung up the drop line. Ignored when there is no drop line. */
  marks: boolean;
  /** The expanding ring a live run carries. */
  ring: boolean;
  /** The additive glow behind the core. */
  glow: boolean;
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
  material: MeshBasicMaterial | SpriteMaterial;
  base: number;
}

export interface SpecimenNode {
  /** At the slot. Never scaled, so the rigging stays attached to the room. */
  group: Group;
  /** What focus, the sweep and arrival scale: the core, the arms, the glow. */
  body: Group;
  core: Mesh;
  glow: Sprite | null;
  arms: SpecimenArm[];
  /** One per finding, strung on the drop line. */
  marks: Mesh[];
  /** Only on a live run. Its opacity is written every frame. */
  ring: Mesh | null;
  materials: ToneMaterial[];
  /**
   * Eased, not switched. These are the *current* values; the scene pushes
   * targets and `applySpecimenFrame` walks them, which is what turned the old
   * 1.55 snap into a response.
   */
  focusAmount: number;
  dimAmount: number;
  /** Where the slot is now, and where it is going. Equal at rest. */
  slotFrom: number;
  slotTo: number;
  /** When the current slide began, in scene seconds. Negative means at rest. */
  slideFrom: number;
  /** When this run arrived. Negative means it was always here. */
  arriveFrom: number;
  spec: Specimen;
}

export interface SpecimenKit {
  /** A detached group. The caller adds it to whatever it is drawing into. */
  build(spec: Specimen): SpecimenNode;
  /** Free one node's own materials and geometries. */
  release(node: SpecimenNode): void;
  /** Free everything shared between nodes. */
  dispose(): void;
}

/**
 * A soft radial dot, as a texture.
 *
 * Greyscale on purpose: it is tinted per specimen by the verdict's own colour,
 * so the glow can never introduce a hue the palette does not already spend. It
 * is drawn once and shared by every node.
 */
function glowTexture(): Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.34)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function lineGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  return geometry;
}

/** An arm is a box scaled along x and swung to its diagonal from the core. */
export function placeArm(arm: Mesh, length: number, dx: number, dy: number): void {
  const axis = Math.SQRT1_2;
  arm.scale.x = length;
  arm.rotation.z = Math.atan2(dy, dx);
  arm.position.set((dx * axis * length) / 2, (dy * axis * length) / 2, 0);
}

/**
 * Four diagonals in the plane facing the camera, in CHECK_NAMES order, so the
 * same check is always the same arm and a lopsided specimen is readable across
 * the whole chamber.
 */
const DIRECTIONS = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
] as const;

export function createSpecimenKit(palette: ChamberPalette, rig: SpecimenRig): SpecimenKit {
  const armGeometry = new BoxGeometry(1, ARM_THICKNESS, ARM_THICKNESS);
  const coreGeometry = new OctahedronGeometry(0.042, 0);
  const markGeometry = new BoxGeometry(0.03, 0.03, 0.03);
  const ringGeometry = new RingGeometry(0.085, 0.1, 28);
  const shadowGeometry = new PlaneGeometry(0.09, 0.09);
  const dropMaterial = new LineBasicMaterial({ color: palette.line, fog: true });
  // Built lazily and only where it is wanted: the texture needs a canvas, and a
  // rig that draws no glow should not touch the DOM to make one.
  let glow: Texture | null = null;

  function build(spec: Specimen): SpecimenNode {
    const group = new Group();
    const materials: ToneMaterial[] = [];
    const toneColor = palette.tone(spec.tone);

    // Hangs off the chain, so the line above is load-bearing rather than
    // decorative. On the group and not the body: focus scales the body, and a
    // drop line that grew with it would overshoot the chain it hangs from.
    if (rig.dropAbove > 0) {
      group.add(new LineSegments(lineGeometry([0, rig.dropAbove, 0, 0, 0, 0]), dropMaterial));
    }

    // The tether to the floor, and the shadow it lands on. Together they are
    // the strongest depth cue available without a light in the room, and both
    // are readings: the foot of the tether is the run's slot on the time axis.
    if (rig.tetherY !== null) {
      group.add(new LineSegments(lineGeometry([0, 0, 0, 0, rig.tetherY, 0]), dropMaterial));
      const shadowMaterial = new MeshBasicMaterial({
        color: toneColor,
        fog: true,
        transparent: true,
        opacity: 0.28,
      });
      const shadow = new Mesh(shadowGeometry, shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = rig.tetherY;
      group.add(shadow);
      materials.push({ material: shadowMaterial, base: 0.28 });
    }

    // One mark per finding, worst nearest the core, strung up the drop line.
    // What the run produced, hanging off what produced it.
    const marks: Mesh[] = [];
    if (rig.marks && rig.dropAbove > 0) {
      spec.marks.forEach((mark, i) => {
        const material = new MeshBasicMaterial({
          color: palette.tone(mark.tone),
          fog: true,
          transparent: true,
          opacity: 1,
        });
        const mesh = new Mesh(markGeometry, material);
        mesh.position.y = 0.085 + i * 0.055;
        group.add(mesh);
        marks.push(mesh);
        materials.push({ material, base: 1 });
      });
    }

    const body = new Group();
    group.add(body);

    // Behind the core, and additive, so it adds light rather than paint. The
    // colour is the verdict's own — this makes a specimen luminous without
    // spending a hue the palette has not already spent.
    let glowSprite: Sprite | null = null;
    if (rig.glow) {
      if (!glow) glow = glowTexture();
      const material = new SpriteMaterial({
        map: glow,
        color: toneColor,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0.4,
        fog: true,
      });
      glowSprite = new Sprite(material);
      glowSprite.scale.setScalar(0.24 * spec.coreScale);
      body.add(glowSprite);
      materials.push({ material, base: 0.4 });
    }

    const coreMaterial = new MeshBasicMaterial({
      color: toneColor,
      fog: true,
      transparent: true,
      opacity: 1,
    });
    const core = new Mesh(coreGeometry, coreMaterial);
    // The worst thing the run found, as size. Fog takes the colour out of a
    // distant specimen long before it takes the silhouette, so a dangerous run
    // at the back of the volume still reads as one.
    core.scale.setScalar(spec.coreScale);
    body.add(core);
    materials.push({ material: coreMaterial, base: 1 });

    const arms: SpecimenArm[] = [];
    spec.bars.forEach((bar, i) => {
      // Length zero is a check that never appeared. Drawing a stub would claim
      // it ran briefly, so nothing is drawn at all and the gap is the fact.
      if (bar.length <= 0) return;
      const direction = DIRECTIONS[i];
      if (!direction) return;
      const material = new MeshBasicMaterial({
        color: palette.tone(bar.tone),
        fog: true,
        transparent: true,
        opacity: 1,
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
    if (rig.ring && spec.live) {
      const ringMaterial = new MeshBasicMaterial({
        color: palette.amber,
        fog: true,
        transparent: true,
        opacity: 0,
      });
      ring = new Mesh(ringGeometry, ringMaterial);
      group.add(ring);
    }

    return {
      group,
      body,
      core,
      glow: glowSprite,
      arms,
      marks,
      ring,
      materials,
      focusAmount: 0,
      dimAmount: 0,
      slotFrom: spec.index,
      slotTo: spec.index,
      slideFrom: -1,
      arriveFrom: -1,
      spec,
    };
  }

  function release(node: SpecimenNode): void {
    node.group.removeFromParent();
    for (const entry of node.materials) entry.material.dispose();
    if (node.ring) (node.ring.material as MeshBasicMaterial).dispose();
    node.group.traverse((child) => {
      if (child instanceof LineSegments) child.geometry.dispose();
    });
  }

  function dispose(): void {
    armGeometry.dispose();
    coreGeometry.dispose();
    markGeometry.dispose();
    ringGeometry.dispose();
    shadowGeometry.dispose();
    dropMaterial.dispose();
    glow?.dispose();
    glow = null;
  }

  return { build, release, dispose };
}

export interface SpecimenFrame {
  elapsed: number;
  reducedMotion: boolean;
  camera: Camera;
  /** Focus and dim, already eased by the scene. */
  focus: number;
  dim: number;
  /** How hard the sweep is reading this specimen, 0–1. */
  read: number;
  /**
   * Arrival, as two numbers rather than one. They are not the same curve on
   * purpose: a new run is fully opaque before it has finished moving, so the
   * shape is solid by the time it lands instead of still fading while it
   * settles. Both are 1 for a specimen that was always here.
   */
  arrivalScale: number;
  arrivalOpacity: number;
}

/**
 * Draw one node's frame.
 *
 * Scale has three contributors and one output, so nothing ever pulses out of
 * phase with the instrument that is supposed to be driving it: focus is the
 * reader, `read` is the sweep, and `alive` is a run still executing.
 */
export function applySpecimenFrame(node: SpecimenNode, frame: SpecimenFrame): void {
  const { elapsed, reducedMotion, camera } = frame;

  const alive = !reducedMotion && node.spec.live ? 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 2.4)) : 0;
  const lift = 1 + frame.read * 0.45 + alive;
  node.body.scale.setScalar((1 + frame.focus * 0.55) * lift * frame.arrivalScale);
  for (const mark of node.marks)
    mark.scale.setScalar((1 + frame.focus * 0.55) * frame.arrivalScale);

  // Opacity is the dim state and the arrival fade at once. Both are multipliers
  // on the material's own resting value, which is not always 1 — the floor
  // shadow is a smudge at 0.28 and must stay one.
  const strength = (1 - frame.dim * (1 - DIMMED)) * frame.arrivalOpacity;
  for (const { material, base } of node.materials) {
    material.opacity = base * strength;
  }

  if (!reducedMotion) {
    // A check still in the sandbox has no measured length, so its arm reaches
    // and retracts around the unmeasured one rather than sitting at a length it
    // never reported.
    for (const arm of node.arms) {
      if (!arm.running) continue;
      const reach = arm.baseLength * (0.82 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 3.1)));
      placeArm(arm.mesh, reach, arm.dx, arm.dy);
    }

    // One second of expansion and fade, restarting: a pulse leaving a run that
    // is still executing.
    if (node.ring) {
      const phase = (elapsed % 1.6) / 1.6;
      node.ring.scale.setScalar(0.7 + phase * 1.9);
      const material = node.ring.material as MeshBasicMaterial;
      material.opacity = 0.5 * (1 - phase) * strength;
      node.ring.lookAt(camera.position);
    }
  } else if (node.ring) {
    // A defined resting value rather than whatever the last frame left: this is
    // the frame reduced motion actually sees.
    node.ring.scale.setScalar(1);
    (node.ring.material as MeshBasicMaterial).opacity = 0.25 * strength;
  }
}

/** Land on the targets without easing, for reduced motion and for a rebuild. */
export function snapSpecimen(node: SpecimenNode, focus: number, dim: number): void {
  node.focusAmount = focus;
  node.dimAmount = dim;
}
