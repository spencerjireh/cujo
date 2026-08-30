/**
 * The room the record hangs in: the shell, the ruler, the occupancy ticks, the
 * chain, and the light that reads along it.
 *
 * Every object in here is a measurement (decision 68). The floor ticks say
 * which slots hold a run, the wall ribs are the axis those slots sit on, the
 * chain threads the record in order and so is exactly as long as the record is,
 * and the sweep is the board re-reading the API. Nothing decorative belongs in
 * this file — that is `atmosphere.ts`, and keeping the two apart is what makes
 * decision 69's claim checkable.
 *
 * Drawn with `Line2` rather than `LineSegments`. `LineBasicMaterial` ignores
 * `linewidth` on every desktop driver, so the room was a one-pixel wireframe
 * that thinned further at high device-pixel ratios, and the only lever left was
 * value — which is why the shell was being multiplied 3.2× above its own token
 * just to be visible. Real width lets the room be drawn at its token value and
 * still read as a room.
 */

import type { Vec3 } from "@/lib/board/caltrop";
import type { ChainPath } from "@/lib/board/chain";
import {
  CEILING_Y,
  CHAMBER_BOX,
  FLOOR_Y,
  MOUTH_Z,
  RECORD_X,
  SHELL_Z,
  slotCount,
  slotZ,
} from "@/lib/board/chamber-layout";
import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Texture,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ChamberPalette } from "./palette";
import { radialTexture } from "./textures";

/**
 * Widths in CSS pixels. `LineMaterial.resolution` is fed the same numbers
 * `renderer.setSize` gets rather than the drawing-buffer size, so a hairline is
 * a hairline at any device-pixel ratio instead of thinning on a retina display.
 */
const WIDTH = { shell: 1.4, rule: 1, tick: 1.6, chain: 2 } as const;

/**
 * How wide the sweep's light is, in scene units.
 *
 * It is a soft light travelling the chain now, not a plane crossing the volume.
 * A plane was right while the record was a line — one depth was one run — and
 * over a scattered field it lights everything at that depth together, which is
 * the one thing the sweep's envelope exists to prevent. It was also drawn as
 * the *edges* of a box of depth 0.001, so what a reader actually saw was an
 * amber rectangle framing the scene rather than light passing through it.
 */
const SWEEP_SIZE = 2.8;
const SWEEP_OPACITY = 0.5;

export interface Room {
  /** Added to the scene by the composer. */
  group: Group;
  /**
   * The chain through the record, and the occupancy ticks under it. Takes the
   * path rather than a count: the chain threads the specimens now, so its shape
   * is the record's own and not something this file can derive.
   */
  setRecord(path: ChainPath): void;
  /** Where the reading head is, or null to hide it, and where to face. */
  setSweep(at: Vec3 | null, faceTo: Vec3): void;
  /** CSS pixels. Every `LineMaterial` needs this to compute its width. */
  setResolution(width: number, height: number): void;
  dispose(): void;
}

function segments(points: number[], material: LineMaterial): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(points);
  return new LineSegments2(geometry, material);
}

/** The twelve edges of a box, as line segments. */
function boxEdges(
  width: number,
  height: number,
  depth: number,
  cx: number,
  cy: number,
  cz: number,
): number[] {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const corner = (x: number, y: number, z: number) => [x, y, z];
  const edge = (a: number[], b: number[]) => [...a, ...b];
  return [
    ...edge(corner(x0, y0, z0), corner(x1, y0, z0)),
    ...edge(corner(x1, y0, z0), corner(x1, y1, z0)),
    ...edge(corner(x1, y1, z0), corner(x0, y1, z0)),
    ...edge(corner(x0, y1, z0), corner(x0, y0, z0)),
    ...edge(corner(x0, y0, z1), corner(x1, y0, z1)),
    ...edge(corner(x1, y0, z1), corner(x1, y1, z1)),
    ...edge(corner(x1, y1, z1), corner(x0, y1, z1)),
    ...edge(corner(x0, y1, z1), corner(x0, y0, z1)),
    ...edge(corner(x0, y0, z0), corner(x0, y0, z1)),
    ...edge(corner(x1, y0, z0), corner(x1, y0, z1)),
    ...edge(corner(x1, y1, z0), corner(x1, y1, z1)),
    ...edge(corner(x0, y1, z0), corner(x0, y1, z1)),
  ];
}

/**
 * The ruler: rails running the length of the volume, and one vertical rib on
 * each side wall at every slot a run could occupy.
 *
 * The ribs are the reason for the rest: with only a floor, a drift of four
 * hundredths of a radian changes nothing you can see, and the box stays a flat
 * rectangle with lines in it. They matter more now than they did — the camera
 * stands inside the mouth, so these are what run off the edges of the frame and
 * tell a reader they are in a space rather than looking at a picture of one.
 */
function railsAndRibs(): number[] {
  const points: number[] = [];
  const halfW = CHAMBER_BOX.width / 2;
  const count = slotCount();
  const front = MOUTH_Z;
  const back = slotZ(count - 1);
  for (let i = -2; i <= 2; i += 1) {
    const x = RECORD_X + (i / 2) * halfW;
    points.push(x, FLOOR_Y, back, x, FLOOR_Y, front);
    // A matching rail overhead. The camera is inside the volume now, so the
    // ceiling is in frame and an empty one reads as the room having no top.
    points.push(x, CEILING_Y, back, x, CEILING_Y, front);
  }
  for (let i = 0; i < count; i += 1) {
    const z = slotZ(i);
    points.push(RECORD_X - halfW, FLOOR_Y, z, RECORD_X - halfW, CEILING_Y, z);
    points.push(RECORD_X + halfW, FLOOR_Y, z, RECORD_X + halfW, CEILING_Y, z);
  }
  return points;
}

export function createRoom(palette: ChamberPalette): Room {
  const group = new Group();
  const materials: LineMaterial[] = [];

  const material = (color: number[] | ChamberPalette["line"], width: number, opacity = 1) => {
    const made = new LineMaterial({
      color: (color as ChamberPalette["line"]).getHex(),
      linewidth: width,
      transparent: opacity < 1,
      opacity,
      // `Line2` does its own fog, and the room has to recede with everything
      // else or the far wall floats in front of the specimens near it.
      fog: true,
      dashed: false,
    });
    materials.push(made);
    return made;
  };

  // Brighter than the token by a little, not by three and a half: real width
  // does the work value used to have to do alone.
  const shellColor = palette.line.clone().multiplyScalar(2.2);
  const ruleColor = palette.line.clone().multiplyScalar(2.4);
  const tickColor = palette.line.clone().multiplyScalar(4);
  const chainColor = palette.line.clone().multiplyScalar(2.4);

  const shell = segments(
    boxEdges(CHAMBER_BOX.width, CHAMBER_BOX.height, CHAMBER_BOX.depth, RECORD_X, 0, SHELL_Z),
    material(shellColor, WIDTH.shell),
  );
  group.add(shell);

  const rails = segments(railsAndRibs(), material(ruleColor, WIDTH.rule, 0.55));
  group.add(rails);

  const tickMaterial = material(tickColor, WIDTH.tick);
  const chainMaterial = material(chainColor, WIDTH.chain);

  // The reading head: a soft additive light, tinted amber, that rides the chain
  // and faces the camera. Additive, so it adds light to what it passes rather
  // than painting over it — a specimen it is reading keeps its own verdict
  // colour underneath.
  const sweepTexture: Texture = radialTexture();
  const sweepMaterial = new MeshBasicMaterial({
    map: sweepTexture,
    color: palette.amber,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: SWEEP_OPACITY,
    fog: true,
  });
  const sweepGeometry = new PlaneGeometry(SWEEP_SIZE, SWEEP_SIZE);
  const sweep = new Mesh(sweepGeometry, sweepMaterial);
  sweep.visible = false;
  group.add(sweep);

  let ticks: LineSegments2 | null = null;
  let chain: LineSegments2 | null = null;

  function clearRecord(): void {
    for (const object of [ticks, chain]) {
      if (!object) continue;
      group.remove(object);
      object.geometry.dispose();
    }
    ticks = null;
    chain = null;
  }

  function setRecord(path: ChainPath): void {
    clearRecord();
    const count = path.points.length;

    // One tick per occupied slot, and none at all on an empty board: the floor
    // says where the record is, so with no record it says nothing. Drawn across
    // the volume at the run's own depth, which is the axis that still carries a
    // measurement now that the other two do not.
    if (count > 0) {
      const points: number[] = [];
      const half = CHAMBER_BOX.width / 2;
      for (const point of path.points) {
        points.push(RECORD_X - half, FLOOR_Y, point.z, RECORD_X + half, FLOOR_Y, point.z);
      }
      ticks = segments(points, tickMaterial);
      group.add(ticks);
    }

    // Cujo is a guard dog on a chain (brand/brand.md), and the chain is what
    // makes a scattered field a *record* rather than a scatter. It threads the
    // specimens in order, so its length is the record's length — decision 68's
    // rule about it, kept by construction rather than by an end-point formula.
    //
    // Nothing is drawn for a record of one: a chain needs two runs to join.
    if (count > 1) {
      const points: number[] = [];
      for (let i = 1; i < count; i += 1) {
        const a = path.points[i - 1];
        const b = path.points[i];
        if (!a || !b) continue;
        points.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      chain = segments(points, chainMaterial);
      group.add(chain);
    }
  }

  function setSweep(at: Vec3 | null, faceTo: Vec3): void {
    sweep.visible = at !== null;
    if (at === null) return;
    sweep.position.set(at.x, at.y, at.z);
    // Billboarded, so the light is a disc from wherever the reader is standing
    // rather than an edge-on sliver when the chain runs toward the camera.
    sweep.lookAt(faceTo.x, faceTo.y, faceTo.z);
  }

  function setResolution(width: number, height: number): void {
    for (const made of materials) made.resolution.set(width, height);
  }

  function dispose(): void {
    clearRecord();
    for (const object of [shell, rails]) {
      group.remove(object);
      object.geometry.dispose();
    }
    group.remove(sweep);
    sweepGeometry.dispose();
    sweepMaterial.dispose();
    sweepTexture.dispose();
    for (const made of materials) made.dispose();
    materials.length = 0;
    group.removeFromParent();
  }

  return { group, setRecord, setSweep, setResolution, dispose };
}
