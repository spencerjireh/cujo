import { BACK_Z, FRONT_Z, RECORD_X, slotZ } from "@/lib/board/chamber-layout";
import { FIELD, minX, scatterAt } from "@/lib/board/scatter";
import { describe, expect, it } from "vitest";

/**
 * Where a run sits across the volume.
 *
 * Position on this axis carries nothing — that is decision 70, and it is the
 * one place the chamber's drawing is deliberately not a measurement. What it
 * still has to be is *stable* and *out of the way*, and both are here.
 */

/** Enough ids to make a claim about the distribution rather than about one. */
const IDS = Array.from({ length: 400 }, (_, i) => `run-${i}-${(i * 7919) % 101}`);

/** Every depth a drawn specimen can occupy, plus the ends of the volume. */
const DEPTHS = [BACK_Z, ...Array.from({ length: 10 }, (_, i) => slotZ(i)), FRONT_Z];

describe("scatterAt", () => {
  it("puts a run in the same place every time", () => {
    // A field reshuffled on every poll would be an animation of nothing, and a
    // reader who found a specimen once could never find it again.
    for (const id of IDS.slice(0, 20)) {
      expect(scatterAt(id, slotZ(3))).toEqual(scatterAt(id, slotZ(3)));
    }
  });

  it("puts different runs in different places", () => {
    const seen = new Set(IDS.map((id) => JSON.stringify(scatterAt(id, slotZ(0)))));
    // Not every id has to be unique — two runs may land close — but a hash
    // that collapsed most of them would draw a line again by accident.
    expect(seen.size).toBeGreaterThan(IDS.length * 0.9);
  });

  it("keeps every run inside the volume, at every depth", () => {
    for (const id of IDS) {
      for (const z of DEPTHS) {
        const { x, y } = scatterAt(id, z);
        expect(x).toBeGreaterThanOrEqual(FIELD.minX - 1e-9);
        expect(x).toBeLessThanOrEqual(FIELD.maxX + 1e-9);
        expect(y).toBeGreaterThanOrEqual(FIELD.minY - 1e-9);
        expect(y).toBeLessThanOrEqual(FIELD.maxY + 1e-9);
      }
    }
  });

  /**
   * The readout is at the left of the frame, top and bottom. Nothing may land
   * behind it — and the floor rises toward the near face, because a specimen
   * there is the largest thing on screen and reaches furthest into the type.
   */
  it("never puts a run left of the clear line for its depth", () => {
    for (const id of IDS) {
      for (const z of DEPTHS) {
        expect(scatterAt(id, z).x).toBeGreaterThanOrEqual(minX(z) - 1e-9);
      }
    }
  });

  it("leans right, so the left of the frame stays sparse rather than empty", () => {
    const xs = IDS.map((id) => scatterAt(id, slotZ(5)).x);
    const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(RECORD_X);
    // Sparse, not empty: a hard split would read as two panels rather than one
    // room, so some runs still sit left of the record's own axis.
    expect(xs.some((x) => x < RECORD_X)).toBe(true);
  });

  it("spreads over the height rather than sitting on one plane", () => {
    const ys = IDS.map((id) => scatterAt(id, BACK_Z).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((FIELD.maxY - FIELD.minY) * 0.8);
  });

  /**
   * The field is a cone rather than a box, and the camera is why: it stands
   * inside the mouth, so the frame at the near end is barely two units across
   * and a newest run at full spread would be off the side of the screen.
   */
  it("holds the near end close to the axis and lets the far end fill the room", () => {
    const spanAt = (z: number) => {
      const xs = IDS.map((id) => scatterAt(id, z).x);
      const ys = IDS.map((id) => scatterAt(id, z).y);
      return Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
    };
    expect(spanAt(FRONT_Z)).toBeLessThan(spanAt(BACK_Z) * 0.45);
    // Not collapsed to a point, though: the newest run is still off the axis.
    expect(spanAt(FRONT_Z)).toBeGreaterThan(0.5);
  });

  it("widens the whole way back, so no depth is a step in the cone", () => {
    let previous = 0;
    for (let z = FRONT_Z; z >= BACK_Z; z -= 0.05) {
      const ys = IDS.map((id) => scatterAt(id, z).y);
      const span = Math.max(...ys) - Math.min(...ys);
      expect(span).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = span;
    }
  });
});

describe("minX", () => {
  it("lets the far end of the record cross under the headline", () => {
    // A specimen back there is small, fogged, and nowhere near the type.
    expect(minX(BACK_Z)).toBeLessThan(RECORD_X);
  });

  it("holds the near end clear of it", () => {
    expect(minX(FRONT_Z)).toBeGreaterThan(minX(BACK_Z));
  });

  it("rises the whole way in, so no depth is a gap in the guard", () => {
    // Swept back to front rather than over the slots, which are not in depth
    // order in `DEPTHS`: the claim is about z, not about the record.
    let previous = minX(BACK_Z);
    for (let z = BACK_Z; z <= FRONT_Z; z += 0.05) {
      expect(minX(z)).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = minX(z);
    }
  });

  it("clamps outside the volume rather than running away", () => {
    expect(minX(BACK_Z - 50)).toBeCloseTo(minX(BACK_Z), 10);
    expect(minX(FRONT_Z + 50)).toBeCloseTo(minX(FRONT_Z), 10);
  });
});
