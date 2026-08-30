/**
 * The room the record hangs in: the shell, the ruler, the occupancy ticks, the
 * chain, and the plane that sweeps through it.
 *
 * Every object in here is a measurement (decision 68). The floor ticks say
 * which slots hold a run, the wall ribs are the axis those slots sit on, the
 * chain ends where the record ends, and the sweep is the board re-reading the
 * API. Nothing decorative belongs in this file — that is `atmosphere.ts`, and
 * keeping the two apart is what makes decision 69's claim checkable.
 *
 * Drawn with `Line2` rather than `LineSegments`. `LineBasicMaterial` ignores
 * `linewidth` on every desktop driver, so the room was a one-pixel wireframe
 * that thinned further at high device-pixel ratios, and the only lever left was
 * value — which is why the shell was being multiplied 3.2× above its own token
 * just to be visible. Real width lets the room be drawn at its token value and
 * still read as a room.
 */

import {
  CEILING_Y,
  CHAMBER_BOX,
  FLOOR_Y,
  FRONT_Z,
  RECORD_X,
  chainEndZ,
  slotCount,
  slotZ,
} from "@/lib/board/chamber-layout";
import { Group } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ChamberPalette } from "./palette";

/**
 * Widths in CSS pixels. `LineMaterial.resolution` is fed the same numbers
 * `renderer.setSize` gets rather than the drawing-buffer size, so a hairline is
 * a hairline at any device-pixel ratio instead of thinning on a retina display.
 */
const WIDTH = { shell: 1.4, rule: 1, tick: 1.6, chain: 2, sweep: 1.6 } as const;

export interface Room {
  /** Added to the scene by the composer. */
  group: Group;
  /** The occupancy ticks and the chain's length, both facts about the record. */
  setRecordLength(count: number): void;
  /** Where the plane is, or null to hide it. */
  setSweep(z: number | null): void;
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
 * rectangle with lines in it.
 */
function railsAndRibs(): number[] {
  const points: number[] = [];
  const halfW = CHAMBER_BOX.width / 2;
  const count = slotCount();
  const front = slotZ(0) + 0.4;
  const back = slotZ(count - 1);
  for (let i = -2; i <= 2; i += 1) {
    const x = RECORD_X + (i / 2) * halfW;
    points.push(x, FLOOR_Y, back, x, FLOOR_Y, front);
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
    boxEdges(
      CHAMBER_BOX.width,
      CHAMBER_BOX.height,
      CHAMBER_BOX.depth,
      RECORD_X,
      0,
      // `SHELL_Z` is the box's centre; the helper takes a centre, so this is it.
      FRONT_Z - CHAMBER_BOX.depth / 2 + 0.6,
    ),
    material(shellColor, WIDTH.shell),
  );
  group.add(shell);

  const rails = segments(railsAndRibs(), material(ruleColor, WIDTH.rule, 0.55));
  group.add(rails);

  const tickMaterial = material(tickColor, WIDTH.tick);
  const chainMaterial = material(chainColor, WIDTH.chain);
  // The scan plane, drawn as a rectangle of lines rather than a filled quad: it
  // reads as a measurement passing through, not as a wall.
  const sweepMaterial = material(palette.amber, WIDTH.sweep, 0.42);

  const sweep = segments(
    boxEdges(CHAMBER_BOX.width * 0.96, CHAMBER_BOX.height * 0.96, 0.001, RECORD_X, 0, 0),
    sweepMaterial,
  );
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

  function setRecordLength(count: number): void {
    clearRecord();

    // One tick per occupied slot, and none at all on an empty board: the floor
    // says where the record is, so with no record it says nothing.
    if (count > 0) {
      const points: number[] = [];
      const half = CHAMBER_BOX.width / 2;
      for (let i = 0; i < count; i += 1) {
        points.push(RECORD_X - half, FLOOR_Y, slotZ(i), RECORD_X + half, FLOOR_Y, slotZ(i));
      }
      ticks = segments(points, tickMaterial);
      group.add(ticks);
    }

    // Cujo is a guard dog on a chain (brand/brand.md), and the chain is what
    // makes a row of specimens a record instead of a scatter. Its length is the
    // record's length — `chainEndZ` holds the empty-board exception.
    const CHAIN_Y_LOCAL = CHAMBER_BOX.height / 2 - 0.22;
    chain = segments(
      [RECORD_X, CHAIN_Y_LOCAL, FRONT_Z + 0.6, RECORD_X, CHAIN_Y_LOCAL, chainEndZ(count)],
      chainMaterial,
    );
    group.add(chain);
  }

  function setSweep(z: number | null): void {
    sweep.visible = z !== null;
    if (z !== null) sweep.position.z = z;
  }

  function setResolution(width: number, height: number): void {
    for (const made of materials) made.resolution.set(width, height);
  }

  function dispose(): void {
    clearRecord();
    for (const object of [shell, rails, sweep]) {
      group.remove(object);
      object.geometry.dispose();
    }
    for (const made of materials) made.dispose();
    materials.length = 0;
    group.removeFromParent();
  }

  return { group, setRecordLength, setSweep, setResolution, dispose };
}
