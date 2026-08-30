/**
 * The air in the room (decision 80), and the sky behind it (decision 82).
 *
 * This is the one file in the scene whose contents are not measurements, and it
 * is a whole file for that reason: decision 80 amends decision 68's first rule
 * with a named exception, and the exception is checkable only if a reader can
 * see where it begins and ends. It is here and in `post.ts`, and nowhere else.
 *
 * Nothing in this module reads a run. It does not import `Specimen`, and it
 * must not: if it ever needs to, the thing being drawn is a measurement and
 * belongs in `room.ts` or `specimens.ts` instead.
 *
 * What it buys: a field of stars in a volume with no lights in it, drawn in
 * unlit materials on a near-black ground, has no way to say "there is space
 * here" — the fog resolves into a flat colour and the record reads as a
 * picture cut out of the page. A graded backdrop gives the fog something to
 * become, the shafts give the sweep something to move through, the star field
 * — far more motes than the record has stars, reaching well past its back
 * layer and off every edge of the frame — is what makes the layers a galaxy
 * rather than rings of objects in the dark, and the lattice behind it all is
 * the grid a drawing has: lines to a vanishing point, which is depth.
 */

import {
  type FieldBox,
  backdropExtent,
  driftDust,
  dustPositions,
  gradeWeight,
  hazeStrength,
} from "@/lib/board/atmosphere-field";
import { BACK_Z, FRONT_Z, RECORD_X } from "@/lib/board/chamber-layout";
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
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ChamberPalette } from "./palette";

/**
 * The star field, in two sizes. Most of it is fine dust; a few larger, fainter
 * motes sit among it so the field has a near and a far of its own.
 */
const STARS = [
  { count: 700, size: 0.018, opacity: 0.55, seed: 20260830 },
  { count: 220, size: 0.036, opacity: 0.4, seed: 20260831 },
] as const;
/** How many haze planes stand in the volume. */
const SHAFT_COUNT = 5;
/** How far a shaft feels the sweep. */
const SHAFT_REACH = 3.4;
/** How far in front of the camera the backdrop sits. Behind everything else. */
const BACKDROP_DISTANCE = 40;

/**
 * The lattice: a wireframe volume round the galaxy, with rails down its
 * length and ribs across its walls at a fixed pitch.
 *
 * It was the room, and it said something — one rib per slot, one tick per
 * occupied slot. It says nothing now and is here for the reason a drawing has
 * a grid behind it: lines running to a vanishing point are the cheapest depth
 * there is, and a field of stars in the dark with nothing behind it reads as
 * flat. The pitch is a fixed number that carries no fact, which is exactly why
 * this is in the decorative file and not in `room.ts`.
 */
const LATTICE = { width: 7.4, height: 4.4, front: 5.5, back: -9.5 } as const;
/** Rails across the floor and ceiling, and ribs down the walls, in scene units. */
const LATTICE_RAIL_PITCH = 1.85;
const LATTICE_RIB_PITCH = 1.2;
const LATTICE_WIDTH_PX = 1.2;
const LATTICE_OPACITY = 0.5;

/**
 * The volume the stars fill. Far larger than the record on every axis, on
 * purpose: an edge of the field inside the frame reads as the field ending,
 * and a galaxy does not end where the record does.
 */
const STAR_BOX: FieldBox = {
  width: 16,
  height: 9,
  depth: 22,
  x: RECORD_X,
  y: 0,
  z: (FRONT_Z + BACK_Z) / 2 - 3,
};

export interface Atmosphere {
  /** The haze, the stars and the lattice. Added to the scene. */
  group: Group;
  /** The backdrop. Parented to the camera, so the composer adds it there. */
  backdrop: Mesh;
  /** Fit the backdrop to the frame it has to fill. */
  setFrame(fovDeg: number, aspect: number): void;
  /** CSS pixels, which is what the lattice's line width is measured in. */
  setResolution(width: number, height: number): void;
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
    // The focus sits right of centre and a little below it, behind the record,
    // which is where the galaxy is densest and so where it would be brightest.
    const weight = gradeWeight(u, v, 0.6, 0.45, 0.95);
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

  // Far wider and taller than the record, on purpose: a quad with an edge
  // inside the frame reads as a pane of glass standing in the record, which is
  // the one thing this layer must not do. Oversized, its edges are outside the
  // frustum and all that is left is the gradient of light through it.
  const shaftGeometry = new PlaneGeometry(STAR_BOX.width * 3, STAR_BOX.height * 3);
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
    // Spread down the record, skewed slightly so they never line up with the
    // gates and read as a second set of them.
    const z = BACK_Z + ((i + 0.5) / SHAFT_COUNT) * (FRONT_Z - BACK_Z) + 0.17;
    mesh.position.set(RECORD_X, 0, z);
    shafts.push({ mesh, material, z });
    group.add(mesh);
  }

  // --- the lattice ----------------------------------------------------------

  const latticePoints: number[] = [];
  {
    const halfW = LATTICE.width / 2;
    const halfH = LATTICE.height / 2;
    const cx = RECORD_X + 0.9;
    const { front, back } = LATTICE;
    // The twelve edges of the volume.
    for (const [y, z0, z1] of [
      [-halfH, back, front],
      [halfH, back, front],
    ] as const) {
      latticePoints.push(cx - halfW, y, z0, cx - halfW, y, z1);
      latticePoints.push(cx + halfW, y, z0, cx + halfW, y, z1);
    }
    for (const z of [front, back]) {
      latticePoints.push(cx - halfW, -halfH, z, cx + halfW, -halfH, z);
      latticePoints.push(cx - halfW, halfH, z, cx + halfW, halfH, z);
      latticePoints.push(cx - halfW, -halfH, z, cx - halfW, halfH, z);
      latticePoints.push(cx + halfW, -halfH, z, cx + halfW, halfH, z);
    }
    // Rails down the floor and the ceiling.
    for (let x = cx - halfW + LATTICE_RAIL_PITCH; x < cx + halfW; x += LATTICE_RAIL_PITCH) {
      latticePoints.push(x, -halfH, back, x, -halfH, front);
      latticePoints.push(x, halfH, back, x, halfH, front);
    }
    // Ribs across the walls.
    for (let z = front - LATTICE_RIB_PITCH; z > back; z -= LATTICE_RIB_PITCH) {
      latticePoints.push(cx - halfW, -halfH, z, cx - halfW, halfH, z);
      latticePoints.push(cx + halfW, -halfH, z, cx + halfW, halfH, z);
    }
  }
  const latticeMaterial = new LineMaterial({
    color: palette.line.clone().multiplyScalar(3.6).getHex(),
    linewidth: LATTICE_WIDTH_PX,
    transparent: true,
    opacity: LATTICE_OPACITY,
    // Unfogged, unlike everything that carries a fact: the lattice is almost
    // entirely behind the fog's near plane, and fogged it is not there at all.
    // It is a grid, and a grid is the same grey at the back of the page.
    fog: false,
    dashed: false,
  });
  const latticeGeometry = new LineSegmentsGeometry();
  latticeGeometry.setPositions(latticePoints);
  group.add(new LineSegments2(latticeGeometry, latticeMaterial));

  // --- the stars ------------------------------------------------------------

  const fields = STARS.map((layer) => {
    const base = dustPositions(layer.count, STAR_BOX, layer.seed);
    const live = new Float32Array(base);
    const geometry = new BufferGeometry();
    const attribute = new BufferAttribute(live, 3);
    attribute.setUsage(35048 /* DynamicDrawUsage */);
    geometry.setAttribute("position", attribute);
    const material = new PointsMaterial({
      color: palette.fgMuted,
      size: layer.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: layer.opacity,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: true,
    });
    group.add(new Points(geometry, material));
    return { base, live, attribute, geometry, material };
  });

  let sweepZ: number | null = null;

  function setFrame(fovDeg: number, aspect: number): void {
    const { width, height } = backdropExtent(fovDeg, aspect, BACKDROP_DISTANCE);
    backdrop.scale.set(width, height, 1);
  }

  function setResolution(width: number, height: number): void {
    latticeMaterial.resolution.set(width, height);
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
    for (const field of fields) {
      driftDust(field.live, field.base, reducedMotion ? 0 : elapsed, STAR_BOX);
      field.attribute.needsUpdate = true;
    }
  }

  function dispose(): void {
    backdropGeometry.dispose();
    backdropMaterial.dispose();
    backdrop.removeFromParent();
    shaftGeometry.dispose();
    for (const shaft of shafts) shaft.material.dispose();
    shafts.length = 0;
    latticeGeometry.dispose();
    latticeMaterial.dispose();
    for (const field of fields) {
      field.geometry.dispose();
      field.material.dispose();
    }
    fields.length = 0;
    group.removeFromParent();
  }

  return { group, backdrop, setFrame, setResolution, setSweep, update, dispose };
}
