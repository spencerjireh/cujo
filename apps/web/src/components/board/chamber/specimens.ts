/**
 * A run, as geometry. The one part of the scene two scenes share.
 *
 * The chamber draws the record hanging on a chain; the run page draws exactly
 * one specimen, beside the pull request's title, with no room around it. They
 * have to be the same drawing — a specimen that means one thing on the board
 * and another on the run page would make the shape decorative — so the builder
 * is here and both callers use it.
 *
 * What separates the two is a rig, not a flag named after the caller. The board
 * passes a floor to land on; the run page passes none, and the tether and the
 * shadow under it are simply not drawn. That is the whole seam: `build()`
 * returns a detached `Group`, and whoever asked for it decides what to add it
 * to.
 *
 * Every rule about what a specimen *means* lives in `@/lib/board/specimen` and
 * `@/lib/board/caltrop`, which are pure and tested. This module only turns that
 * into meshes.
 */

import { ARM_DIRECTIONS, markRing } from "@/lib/board/caltrop";
import { ARM_MAX, ARM_THICKNESS } from "@/lib/board/chamber-layout";
import type { Specimen } from "@/lib/board/specimen";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Camera,
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
  Vector3,
} from "three";
import type { ChamberPalette } from "./palette";
import { radialTexture } from "./textures";

/** How much of its colour a specimen keeps while another one is lit. */
export const DIMMED = 0.45;

/**
 * The core, sized against the arms rather than in absolute units.
 *
 * It used to be 0.042 against an `ARM_MAX` of 0.3 — the verdict drawn as the
 * smallest thing in a picture that exists to show the verdict. Stated as a
 * ratio so the relationship survives the arms being resized, which is the sort
 * of change that otherwise silently undoes this one.
 */
const CORE_RADIUS = ARM_MAX * 0.16;

/** The hollow half of an arm: thinner and fainter, never a second hue. */
const HOLLOW_THICKNESS = ARM_THICKNESS * 0.5;
const HOLLOW_OPACITY = 0.34;

/** One finding, as a cube on the ring around the core. */
const MARK_SIZE = ARM_MAX * 0.055;

/** `setFromUnitVectors` needs the axis a box's length runs along. */
const X_AXIS = new Vector3(1, 0, 0);

/**
 * What the specimen is hung on, which is the only thing the two scenes differ
 * by. Every field here is a fact about the room, so a scene with no room sets
 * them all to nothing and the builder draws a bare shape.
 */
export interface SpecimenRig {
  /** Local y of the floor under the core. Null draws no tether and no shadow. */
  tetherY: number | null;
  /** The expanding ring a live run carries. */
  ring: boolean;
  /** The additive glow behind the core. */
  glow: boolean;
}

interface SpecimenArm {
  /** The sandbox's share, always drawn. */
  solid: Mesh;
  /** What was left, drawn only when the check measured a share to leave. */
  hollow: Mesh | null;
  /** Its measured length, which the running pulse oscillates around. */
  baseLength: number;
  /** 0 to 1, or null for an arm drawn undivided. */
  share: number | null;
  direction: Vector3;
  running: boolean;
}

/**
 * A material and the opacity it returns to when nothing is dimmed.
 *
 * Carried rather than inferred, because the specimens are not all opaque: the
 * floor shadow is a smudge at 0.28 and the hollow half of an arm sits at 0.34,
 * and resetting either to 1 would turn it into something it is not. The dim
 * state has to be reversible without guessing.
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
  /** One per finding, on the ring around the core. */
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

function lineGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  return geometry;
}

/**
 * Put one segment of an arm between two distances along its direction.
 *
 * A box scaled along x and turned onto the direction, rather than swung in a
 * plane: the arms leave the core on the four diagonals of a cube now, so no two
 * of them share a plane and there is no angle to rotate by.
 */
export function placeSegment(mesh: Mesh, direction: Vector3, from: number, to: number): void {
  const length = Math.max(to - from, 0);
  // Never exactly zero: a zero scale collapses the matrix and three warns.
  mesh.scale.x = Math.max(length, 1e-5);
  mesh.visible = length > 1e-4;
  mesh.quaternion.setFromUnitVectors(X_AXIS, direction);
  mesh.position.copy(direction).multiplyScalar(from + length / 2);
}

/** Lay both halves of an arm out for a total reach. */
function layArm(arm: SpecimenArm, reach: number): void {
  const split = arm.share === null ? reach : reach * arm.share;
  placeSegment(arm.solid, arm.direction, 0, split);
  if (arm.hollow) placeSegment(arm.hollow, arm.direction, split, reach);
}

export function createSpecimenKit(palette: ChamberPalette, rig: SpecimenRig): SpecimenKit {
  const armGeometry = new BoxGeometry(1, ARM_THICKNESS, ARM_THICKNESS);
  const hollowGeometry = new BoxGeometry(1, HOLLOW_THICKNESS, HOLLOW_THICKNESS);
  const coreGeometry = new OctahedronGeometry(CORE_RADIUS, 0);
  const markGeometry = new BoxGeometry(MARK_SIZE, MARK_SIZE, MARK_SIZE);
  // Thin, and sized against the arms rather than the core: a thick ring at
  // arm's length reads as a reticle drawn around the specimen, where a
  // hairline that expands and fades reads as something the run is emitting.
  const ringGeometry = new RingGeometry(ARM_MAX * 0.3, ARM_MAX * 0.315, 40);
  const shadowGeometry = new PlaneGeometry(CORE_RADIUS * 2.2, CORE_RADIUS * 2.2);
  const tetherMaterial = new LineBasicMaterial({ color: palette.line, fog: true });
  // Built lazily and only where it is wanted: the texture needs a canvas, and a
  // rig that draws no glow should not touch the DOM to make one.
  let glow: Texture | null = null;

  function build(spec: Specimen): SpecimenNode {
    const group = new Group();
    const materials: ToneMaterial[] = [];
    const toneColor = palette.tone(spec.tone);

    // The tether to the floor, and the shadow it lands on. Together they are
    // the strongest depth cue available without a light in the room, and both
    // are readings: the foot of the tether is where the run sits in the volume.
    if (rig.tetherY !== null) {
      group.add(new LineSegments(lineGeometry([0, 0, 0, 0, rig.tetherY, 0]), tetherMaterial));
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

    const body = new Group();
    group.add(body);

    // Behind the core, and additive, so it adds light rather than paint. The
    // colour is the verdict's own — this makes a specimen luminous without
    // spending a hue the palette has not already spent.
    let glowSprite: Sprite | null = null;
    if (rig.glow) {
      if (!glow) glow = radialTexture();
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
      glowSprite.scale.setScalar(CORE_RADIUS * 3.4 * spec.coreScale);
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
      const direction = ARM_DIRECTIONS[i];
      if (!direction) return;
      const color = palette.tone(bar.tone);
      const solidMaterial = new MeshBasicMaterial({
        color,
        fog: true,
        transparent: true,
        opacity: 1,
      });
      const solid = new Mesh(armGeometry, solidMaterial);
      body.add(solid);
      materials.push({ material: solidMaterial, base: 1 });

      // Only where there is a share to leave. An arm the check measured no
      // split for is one whole piece — a hollow tail at zero length would be
      // invisible anyway, but it would also put a second material on a node for
      // every unmeasured check on the board.
      let hollow: Mesh | null = null;
      if (bar.solid !== null && bar.solid < 1) {
        // Same hue, less of it. Decision 68 rejected a second colour for the
        // sandbox share by name; strength is what it asked for instead.
        const hollowMaterial = new MeshBasicMaterial({
          color,
          fog: true,
          transparent: true,
          opacity: HOLLOW_OPACITY,
        });
        hollow = new Mesh(hollowGeometry, hollowMaterial);
        body.add(hollow);
        materials.push({ material: hollowMaterial, base: HOLLOW_OPACITY });
      }

      const arm: SpecimenArm = {
        solid,
        hollow,
        baseLength: bar.length * ARM_MAX,
        share: bar.solid,
        direction: new Vector3(direction.x, direction.y, direction.z),
        running: bar.outcome === "running",
      };
      layArm(arm, arm.baseLength);
      arms.push(arm);
    });

    // One mark per finding, on a ring around the core: what the run produced,
    // orbiting the verdict it produced. They used to be strung up a drop line,
    // which read as a barcode at any distance and hung off rigging this
    // specimen no longer has.
    const marks: Mesh[] = [];
    const ringRadius = CORE_RADIUS * spec.coreScale + MARK_SIZE * 1.4;
    markRing(spec.marks.length).forEach((angle, i) => {
      const mark = spec.marks[i];
      if (!mark) return;
      const material = new MeshBasicMaterial({
        color: palette.tone(mark.tone),
        fog: true,
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(markGeometry, material);
      mesh.position.set(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0);
      body.add(mesh);
      marks.push(mesh);
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
    hollowGeometry.dispose();
    coreGeometry.dispose();
    markGeometry.dispose();
    ringGeometry.dispose();
    shadowGeometry.dispose();
    tetherMaterial.dispose();
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

  // Opacity is the dim state and the arrival fade at once. Both are multipliers
  // on the material's own resting value, which is not always 1 — the floor
  // shadow is a smudge at 0.28 and the hollow half of an arm sits at 0.34, and
  // both must stay what they are.
  const strength = (1 - frame.dim * (1 - DIMMED)) * frame.arrivalOpacity;
  for (const { material, base } of node.materials) {
    material.opacity = base * strength;
  }

  if (!reducedMotion) {
    // A check still in the sandbox has no measured length, so its arm reaches
    // and retracts around the unmeasured one rather than sitting at a length it
    // never reported. Both halves move with it: the share is a proportion, so
    // it holds at every reach.
    for (const arm of node.arms) {
      if (!arm.running) continue;
      layArm(arm, arm.baseLength * (0.82 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 3.1))));
    }

    // One second of expansion and fade, restarting: a pulse leaving a run that
    // is still executing.
    if (node.ring) {
      const phase = (elapsed % 1.6) / 1.6;
      node.ring.scale.setScalar(0.55 + phase * 1.35);
      const material = node.ring.material as MeshBasicMaterial;
      // Faint. It is a pulse leaving a run that is still executing, and at the
      // near end of the record a heavier one reads as a reticle drawn around
      // the specimen rather than as something the specimen is emitting.
      material.opacity = 0.3 * (1 - phase) * strength;
      node.ring.lookAt(camera.position);
    }
  } else if (node.ring) {
    // A defined resting value rather than whatever the last frame left: this is
    // the frame reduced motion actually sees.
    node.ring.scale.setScalar(1);
    (node.ring.material as MeshBasicMaterial).opacity = 0.18 * strength;
  }
}

/** Land on the targets without easing, for reduced motion and for a rebuild. */
export function snapSpecimen(node: SpecimenNode, focus: number, dim: number): void {
  node.focusAmount = focus;
  node.dimAmount = dim;
}
