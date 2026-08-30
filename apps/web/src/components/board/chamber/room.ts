/**
 * What is drawn round the record: the gates, one per layer of it, and the
 * light that reads through them.
 *
 * Every object in here is a measurement (decision 68, as narrowed by 71). A
 * gate is drawn at a layer's depth and only while that layer holds a run, so
 * five gates say the record is five layers deep and two say it is two. There
 * is no room any more — no shell, no rails, no floor — because a galaxy is not
 * in a box, and a wireframe corridor round a field of stars was the thing that
 * made it read as a hallway with objects in it. Nothing decorative belongs in
 * this file; that is `atmosphere.ts`, and keeping the two apart is what makes
 * decision 69's claim checkable.
 *
 * Drawn with `Line2` rather than `LineSegments`. `LineBasicMaterial` ignores
 * `linewidth` on every desktop driver, so a hairline gate would thin further at
 * high device-pixel ratios; real width lets it be drawn at its token value and
 * still read.
 */

import { LAYER_COUNT } from "@/lib/board/chamber-layout";
import { bandOf } from "@/lib/board/galaxy";
import { readStrength } from "@/lib/board/sweep";
import { Color, Group } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ChamberPalette } from "./palette";

/** Segments round a gate. Enough for an ellipse; few enough to be free. */
const GATE_SEGMENTS = 96;
/** Widths in CSS pixels, at rest and while the sweep is reading the layer. */
const WIDTH = { rest: 1.1, read: 1.9 } as const;
const OPACITY = { rest: 0.32, read: 0.9 } as const;

export interface Room {
  /** Added to the scene by the composer. */
  group: Group;
  /** Which layers hold a run. A gate is drawn only for one that does. */
  setOccupied(occupied: readonly boolean[]): void;
  /** Where the reading plane is, or null to rest every gate. */
  setSweep(planeZ: number | null): void;
  /** CSS pixels. Every `LineMaterial` needs this to compute its width. */
  setResolution(width: number, height: number): void;
  dispose(): void;
}

/** The loop of a band's ellipse, at its depth, as line segments. */
function gateLoop(layer: number): number[] {
  const band = bandOf(layer);
  const points: number[] = [];
  for (let i = 0; i < GATE_SEGMENTS; i += 1) {
    const a = (i / GATE_SEGMENTS) * 2 * Math.PI;
    const b = ((i + 1) / GATE_SEGMENTS) * 2 * Math.PI;
    points.push(band.x + Math.cos(a) * band.rx, Math.sin(a) * band.ry, band.z);
    points.push(band.x + Math.cos(b) * band.rx, Math.sin(b) * band.ry, band.z);
  }
  return points;
}

export function createRoom(palette: ChamberPalette): Room {
  const group = new Group();

  // Brighter than the token by a little, not by three and a half: real width
  // does the work value used to have to do alone.
  const rest = palette.line.clone().multiplyScalar(2.6);
  const lit = palette.amber.clone();
  const scratch = new Color();

  const gates: { mesh: LineSegments2; material: LineMaterial; z: number }[] = [];
  for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
    const material = new LineMaterial({
      color: rest.getHex(),
      linewidth: WIDTH.rest,
      transparent: true,
      opacity: OPACITY.rest,
      // `Line2` does its own fog, and a gate has to recede with the layer it
      // marks or the far one floats in front of the stars near it.
      fog: true,
      dashed: false,
    });
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(gateLoop(layer));
    const mesh = new LineSegments2(geometry, material);
    mesh.visible = false;
    group.add(mesh);
    gates.push({ mesh, material, z: bandOf(layer).z });
  }

  function setOccupied(occupied: readonly boolean[]): void {
    gates.forEach((gate, layer) => {
      gate.mesh.visible = occupied[layer] === true;
    });
  }

  function setSweep(planeZ: number | null): void {
    for (const gate of gates) {
      const read = planeZ === null ? 0 : readStrength(planeZ, gate.z);
      // The gate is the light: it goes amber and solid as the plane reaches
      // it, and settles back as the plane passes. Amber, which brand.md puts on
      // exactly the sweep and the verdict waiting on a person.
      scratch.copy(rest).lerp(lit, read);
      gate.material.color.copy(scratch);
      gate.material.opacity = OPACITY.rest + (OPACITY.read - OPACITY.rest) * read;
      gate.material.linewidth = WIDTH.rest + (WIDTH.read - WIDTH.rest) * read;
    }
  }

  function setResolution(width: number, height: number): void {
    for (const gate of gates) gate.material.resolution.set(width, height);
  }

  function dispose(): void {
    for (const gate of gates) {
      group.remove(gate.mesh);
      gate.mesh.geometry.dispose();
      gate.material.dispose();
    }
    gates.length = 0;
    group.removeFromParent();
  }

  return { group, setOccupied, setSweep, setResolution, dispose };
}
