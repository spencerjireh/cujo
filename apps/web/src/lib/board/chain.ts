/**
 * The chain, as a path through the record.
 *
 * It used to be one straight line above the specimens, each of which hung off
 * it on a drop line. The record is a field now, so the chain threads it: a taut
 * polyline from the newest run to the oldest, in order. That keeps the chain
 * load-bearing — its length is still the record's length, which is decision
 * 68's rule about it — and it is the only thing left saying that a scattered
 * field is a *series*.
 *
 * It is also what the sweep travels along. A plane crossing the volume lights
 * everything at one depth at once, and with the record spread out that is
 * several runs together; a cursor running the chain visits them one at a time,
 * in the order the board read them.
 *
 * Pure, so both of those claims are testable without a renderer.
 */

import type { Vec3 } from "./caltrop";
import { clamp01 } from "./ease";

export interface ChainPath {
  /** The specimens, in record order: newest first. */
  points: readonly Vec3[];
  /** Distance along the chain to each point. `arcs[0]` is always 0. */
  arcs: readonly number[];
  /** Total length, which is the record's length. */
  length: number;
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function chainPath(points: readonly Vec3[]): ChainPath {
  const arcs: number[] = [];
  let total = 0;
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (previous) total += distance(previous, point);
    arcs.push(total);
  });
  return { points, arcs, length: total };
}

/**
 * The point this far along the chain.
 *
 * Clamped at both ends rather than extrapolated: the sweep runs from before the
 * far end to past the near one, so it asks for positions outside the chain on
 * purpose, and it should sit at the end of it rather than off into the fog.
 */
export function pointAtArc(path: ChainPath, s: number): Vec3 {
  const { points, arcs, length } = path;
  const first = points[0];
  if (!first) return ORIGIN;
  if (points.length === 1 || length <= 0) return first;
  const target = clamp01(s / length) * length;
  // Linear scan. The record is ten specimens; a binary search here would be
  // more code than the loop it replaces and would run once a frame either way.
  for (let i = 1; i < points.length; i += 1) {
    const from = arcs[i - 1] ?? 0;
    const to = arcs[i] ?? 0;
    if (target > to && i < points.length - 1) continue;
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) break;
    const span = to - from;
    const t = span <= 0 ? 0 : clamp01((target - from) / span);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
  return points[points.length - 1] ?? first;
}

/**
 * The shortest gap between two consecutive runs on the chain.
 *
 * The sweep's envelope has to be narrower than this, or two specimens light
 * together and the instrument stops reading one at a time. Infinity for a
 * record too short to have a gap, which is the honest answer: nothing can
 * collide.
 */
export function minSegment(path: ChainPath): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.arcs.length; i += 1) {
    min = Math.min(min, (path.arcs[i] ?? 0) - (path.arcs[i - 1] ?? 0));
  }
  return min;
}
