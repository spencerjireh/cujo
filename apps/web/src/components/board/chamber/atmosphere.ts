/**
 * The air in the room (decision 69).
 *
 * This is the one file in the scene whose contents are not measurements, and it
 * is a whole file for that reason: decision 69 amends decision 68's first rule
 * with a named exception, and the exception is checkable only if a reader can
 * see where it begins and ends. It is here and in `post.ts`, and nowhere else.
 *
 * Nothing in this module reads a run. It does not import `Specimen`, and it
 * must not: if it ever needs to, the thing being drawn is a measurement and
 * belongs in `room.ts` or `specimens.ts` instead.
 *
 * What it buys: a volume with no lights in it, drawn in unlit materials on a
 * near-black ground, has no way to say "there is space here" — the fog resolves
 * into a flat colour and the box reads as a rectangle cut out of the page. A
 * graded backdrop gives the fog something to become, the shafts give the sweep
 * something to move through, and the dust is the only thing on a quiet board
 * that is moving at all.
 */

import {
  type FieldBox,
  backdropExtent,
  driftDust,
  dustPositions,
  gradeWeight,
  hazeStrength,
} from "@/lib/board/atmosphere-field";
import { BACK_Z, CHAMBER_BOX, FRONT_Z, RECORD_X } from "@/lib/board/chamber-layout";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
} from "three";
import type { ChamberPalette } from "./palette";

/** How many motes. Enough to be air, few enough to be free. */
const DUST_COUNT = 220;
/** How many haze planes stand in the volume. */
const SHAFT_COUNT = 5;
/** How far a shaft feels the sweep. */
const SHAFT_REACH = 3.4;
/** How far in front of the camera the backdrop sits. Behind everything else. */
const BACKDROP_DISTANCE = 40;

/** The volume the dust fills: the box, slightly inset so nothing clips a wall. */
const DUST_BOX: FieldBox = {
  width: CHAMBER_BOX.width * 0.94,
  height: CHAMBER_BOX.height * 0.9,
  depth: CHAMBER_BOX.depth * 0.96,
  x: RECORD_X,
  y: 0,
  z: FRONT_Z - CHAMBER_BOX.depth / 2 + 0.6,
};

export interface Atmosphere {
  /** The haze and the dust. Added to the scene. */
  group: Group;
  /** The backdrop. Parented to the camera, so the composer adds it there. */
  backdrop: Mesh;
  /** Fit the backdrop to the frame it has to fill. */
  setFrame(fovDeg: number, aspect: number): void;
  /** Where the sweep is, so the haze it passes through brightens. */
  setSweep(z: number | null): void;
  update(elapsed: number, reducedMotion: boolean): void;
  dispose(): void;
}

export function createAtmosphere(palette: ChamberPalette): Atmosphere {
  const group = new Group();

  // --- the backdrop ---------------------------------------------------------

  // A graded plane rather than a flat clear colour. Vertex-coloured between the
  // chamber token and a brightened copy of it, so the grade cannot introduce a
  // colour the palette does not already contain — the tokens are unchanged and
  // brightness is the only lever, which is the rule the whole scene keeps.
  const backdropGeometry = new PlaneGeometry(1, 1, 12, 12);
  const position = backdropGeometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const near = palette.chamber.clone();
  const far = palette.chamber.clone().multiplyScalar(3.4);
  for (let i = 0; i < position.count; i += 1) {
    // The plane is one unit across and centred, so this maps to 0–1.
    const u = (position.getX(i) ?? 0) + 0.5;
    const v = (position.getY(i) ?? 0) + 0.5;
    // The focus sits below centre and right of it, under the record, which is
    // where the volume's floor is and so where a room would be brightest.
    const weight = gradeWeight(u, v, 0.62, 0.36, 0.95);
    colors[i * 3] = near.r + (far.r - near.r) * weight;
    colors[i * 3 + 1] = near.g + (far.g - near.g) * weight;
    colors[i * 3 + 2] = near.b + (far.b - near.b) * weight;
  }
  backdropGeometry.setAttribute("color", new BufferAttribute(colors, 3));

  const backdropMaterial = new MeshBasicMaterial({
    vertexColors: true,
    // Fog would grey out the thing the fog is supposed to resolve into.
    fog: false,
    depthWrite: false,
    toneMapped: false,
  });
  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  backdrop.position.z = -BACKDROP_DISTANCE;
  backdrop.renderOrder = -1;

  // --- the shafts -----------------------------------------------------------

  // Far wider and taller than the volume, on purpose: a quad with an edge
  // inside the frame reads as a pane of glass standing in the record, which is
  // the one thing this layer must not do. Oversized, its edges are outside the
  // frustum and all that is left is the gradient of light through it.
  const shaftGeometry = new PlaneGeometry(CHAMBER_BOX.width * 5, CHAMBER_BOX.height * 5);
  const shafts: { mesh: Mesh; material: MeshBasicMaterial; z: number }[] = [];
  const shaftColor = palette.fgMuted.clone().multiplyScalar(0.35);
  for (let i = 0; i < SHAFT_COUNT; i += 1) {
    const material = new MeshBasicMaterial({
      color: shaftColor,
      transparent: true,
      opacity: 0.05,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const mesh = new Mesh(shaftGeometry, material);
    // Spread down the volume, skewed slightly so they never line up with the
    // slot ribs and read as a second ruler.
    const z = BACK_Z + ((i + 0.5) / SHAFT_COUNT) * (FRONT_Z - BACK_Z) + 0.17;
    mesh.position.set(RECORD_X, 0, z);
    shafts.push({ mesh, material, z });
    group.add(mesh);
  }

  // --- the dust -------------------------------------------------------------

  const base = dustPositions(DUST_COUNT, DUST_BOX, 20260830);
  const live = new Float32Array(base);
  const dustGeometry = new BufferGeometry();
  const dustAttribute = new BufferAttribute(live, 3);
  dustAttribute.setUsage(35048 /* DynamicDrawUsage */);
  dustGeometry.setAttribute("position", dustAttribute);
  const dustMaterial = new PointsMaterial({
    color: palette.fgMuted,
    size: 0.012,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  group.add(dust);

  let sweepZ: number | null = null;

  function setFrame(fovDeg: number, aspect: number): void {
    const { width, height } = backdropExtent(fovDeg, aspect, BACKDROP_DISTANCE);
    backdrop.scale.set(width, height, 1);
  }

  function setSweep(z: number | null): void {
    sweepZ = z;
  }

  function update(elapsed: number, reducedMotion: boolean): void {
    for (const shaft of shafts) {
      // Scaled far down from the raw strength: this is haze, and a shaft that
      // reads as a surface is a wall standing in the record. Five of them
      // stack, so the number that matters is the sum, not one of them.
      shaft.material.opacity = hazeStrength(shaft.z, sweepZ, SHAFT_REACH) * 0.022;
    }
    // At elapsed 0 this writes back exactly the seeded field, which is what
    // makes the reduced-motion frame the same frame every time.
    driftDust(live, base, reducedMotion ? 0 : elapsed, DUST_BOX);
    dustAttribute.needsUpdate = true;
  }

  function dispose(): void {
    backdropGeometry.dispose();
    backdropMaterial.dispose();
    backdrop.removeFromParent();
    shaftGeometry.dispose();
    for (const shaft of shafts) shaft.material.dispose();
    shafts.length = 0;
    dustGeometry.dispose();
    dustMaterial.dispose();
    group.removeFromParent();
  }

  return { group, backdrop, setFrame, setSweep, update, dispose };
}
