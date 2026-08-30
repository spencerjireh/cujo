import type { Vec3 } from "@/lib/board/caltrop";
import { chainPath, minSegment, pointAtArc } from "@/lib/board/chain";
import { describe, expect, it } from "vitest";

/**
 * The chain, as a path through the record.
 *
 * Two things depend on it being right. Its length is the record's length, which
 * is decision 68's rule about the chain and the reason it may exist at all; and
 * the sweep travels it, so `pointAtArc` is what puts the cursor on one run at a
 * time however the field is scattered.
 */

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe("chainPath", () => {
  it("has no length at all for an empty record", () => {
    const path = chainPath([]);
    expect(path.length).toBe(0);
    expect(path.arcs).toEqual([]);
  });

  it("has no length for a record of one run", () => {
    // One specimen is not a series, and a chain drawn past it would claim a
    // record that is not there.
    expect(chainPath([at(0, 0, 0)]).length).toBe(0);
  });

  it("measures the distance actually travelled, not the depth spanned", () => {
    // The scattered field is the whole reason: two runs one slot apart in depth
    // are further apart than that once they sit at different heights.
    const straight = chainPath([at(0, 0, 0), at(0, 0, -3)]);
    const scattered = chainPath([at(0, 0, 0), at(4, 0, -3)]);
    expect(straight.length).toBe(3);
    expect(scattered.length).toBe(5);
  });

  it("starts at zero and never goes backwards", () => {
    const path = chainPath([at(0, 0, 1), at(1, 1, 0), at(-1, 0, -2), at(2, -1, -4)]);
    expect(path.arcs[0]).toBe(0);
    for (let i = 1; i < path.arcs.length; i += 1) {
      expect(path.arcs[i] ?? 0).toBeGreaterThan(path.arcs[i - 1] ?? 0);
    }
    expect(path.arcs.at(-1)).toBeCloseTo(path.length, 10);
  });
});

describe("pointAtArc", () => {
  const path = chainPath([at(0, 0, 0), at(0, 0, -4), at(3, 0, -4)]);

  it("lands on the ends", () => {
    expect(pointAtArc(path, 0)).toEqual(at(0, 0, 0));
    expect(pointAtArc(path, path.length)).toEqual(at(3, 0, -4));
  });

  it("walks the segments in order", () => {
    expect(pointAtArc(path, 2)).toEqual(at(0, 0, -2));
    expect(pointAtArc(path, 4)).toEqual(at(0, 0, -4));
    expect(pointAtArc(path, 5.5)).toEqual(at(1.5, 0, -4));
  });

  /**
   * The sweep starts before the far end and finishes past the near one, so it
   * asks for positions off both ends of the chain on purpose. It should sit at
   * the end rather than fly off into the fog.
   */
  it("clamps at both ends rather than extrapolating", () => {
    expect(pointAtArc(path, -20)).toEqual(at(0, 0, 0));
    expect(pointAtArc(path, path.length + 20)).toEqual(at(3, 0, -4));
  });

  it("answers for a record too short to have a path", () => {
    expect(pointAtArc(chainPath([at(1, 2, 3)]), 5)).toEqual(at(1, 2, 3));
    expect(pointAtArc(chainPath([]), 0)).toEqual(at(0, 0, 0));
  });
});

describe("minSegment", () => {
  it("finds the tightest gap between two consecutive runs", () => {
    expect(minSegment(chainPath([at(0, 0, 0), at(0, 0, -4), at(0, 0, -5)]))).toBe(1);
  });

  it("has nothing to collide with on a record too short to have a gap", () => {
    expect(minSegment(chainPath([at(0, 0, 0)]))).toBe(Number.POSITIVE_INFINITY);
    expect(minSegment(chainPath([]))).toBe(Number.POSITIVE_INFINITY);
  });
});
