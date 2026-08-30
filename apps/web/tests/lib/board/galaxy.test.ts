import { LAYER_COUNT, RECORD_X, RING_MAX, layerZ } from "@/lib/board/chamber-layout";
import {
  BAND_FLATTEN,
  CAPACITY,
  LAYER_CAPACITY,
  bandOf,
  layerOf,
  minX,
  placeAt,
  placeIn,
} from "@/lib/board/galaxy";
import { describe, expect, it } from "vitest";

/**
 * Where a run sits in the galaxy.
 *
 * Position within a layer carries nothing — that is decision 70, kept by 71,
 * and it is the one place the chamber's drawing is deliberately not a
 * measurement. What it still has to be is *stable*, *apart*, and *out of the
 * way*, and all three are here.
 */

/** Enough ids to make a claim about the distribution rather than about one. */
const IDS = Array.from({ length: 600 }, (_, i) => `run-${i}-${(i * 7919) % 101}`);

/**
 * How far apart two stars in one layer must stay. Less than two full rings:
 * the rings are tilted, so their projections overlap a little before the
 * systems read as one, and a galaxy whose systems never came near each other
 * would be a grid.
 */
const SEPARATION = RING_MAX * 1.5;

describe("layerOf", () => {
  it("has three layers that hold thirty runs between them", () => {
    expect(LAYER_CAPACITY).toHaveLength(LAYER_COUNT);
    expect(CAPACITY).toBe(30);
  });

  it("fills the layers in order, newest in front", () => {
    expect(layerOf(0)).toEqual({ layer: 0, slot: 0 });
    expect(layerOf(5)).toEqual({ layer: 0, slot: 5 });
    expect(layerOf(6)).toEqual({ layer: 1, slot: 0 });
    expect(layerOf(29)).toEqual({ layer: 2, slot: 13 });
  });

  it("puts a run past the capacity in the last layer rather than nowhere", () => {
    expect(layerOf(30).layer).toBe(2);
    expect(layerOf(31).layer).toBe(2);
  });

  it("holds fewer runs in front than behind", () => {
    // Six large stars in front and the rest denser behind is the near-to-far
    // gradient a galaxy has.
    for (let i = 1; i < LAYER_CAPACITY.length; i += 1) {
      expect(LAYER_CAPACITY[i] ?? 0).toBeGreaterThanOrEqual(LAYER_CAPACITY[i - 1] ?? 0);
    }
  });
});

describe("placeIn", () => {
  it("puts a run in the same place every time", () => {
    for (const id of IDS.slice(0, 20)) {
      expect(placeIn(2, 1, id)).toEqual(placeIn(2, 1, id));
    }
  });

  it("puts different runs in different places", () => {
    const seen = new Set(IDS.map((id) => JSON.stringify(placeIn(1, 0, id))));
    expect(seen.size).toBeGreaterThan(IDS.length * 0.9);
  });

  it("sits every run at its layer's depth and nowhere else", () => {
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      for (const id of IDS.slice(0, 50)) {
        expect(placeIn(layer, 0, id).z).toBe(layerZ(layer));
      }
    }
  });

  it("keeps every run inside its band", () => {
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      const band = bandOf(layer);
      const capacity = LAYER_CAPACITY[layer] ?? 0;
      for (let slot = 0; slot < capacity; slot += 1) {
        for (const id of IDS) {
          const p = placeIn(layer, slot, id);
          const u = (p.x - band.x) / band.rx;
          const v = p.y / band.ry;
          expect(u * u + v * v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  /**
   * The property the jitter bounds exist for: two runs in one layer never
   * collide, whatever their ids. Checked over many random records rather than
   * one, because the worst case is two neighbours jittered toward each other.
   */
  it("keeps every pair in a layer apart, whatever the ids", () => {
    let worst = Number.POSITIVE_INFINITY;
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      const capacity = LAYER_CAPACITY[layer] ?? 0;
      for (let trial = 0; trial < 300; trial += 1) {
        const points = Array.from({ length: capacity }, (_, slot) =>
          placeIn(layer, slot, IDS[(trial * 7 + slot * 13) % IDS.length] ?? "x"),
        );
        for (let i = 0; i < points.length; i += 1) {
          for (let j = i + 1; j < points.length; j += 1) {
            const a = points[i];
            const b = points[j];
            if (!a || !b) throw new Error("unreachable");
            worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y));
          }
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(SEPARATION);
  });

  /**
   * The readout is at the left of the frame, top and bottom. Nothing may land
   * behind it — and the line rises toward the front, because a star there is
   * the largest thing on screen and reaches furthest into the type.
   */
  it("never puts a run left of the clear line for its layer", () => {
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      const capacity = LAYER_CAPACITY[layer] ?? 0;
      for (let slot = 0; slot < capacity; slot += 1) {
        for (const id of IDS.slice(0, 100)) {
          expect(placeIn(layer, slot, id).x).toBeGreaterThanOrEqual(minX(layer) - 1e-9);
        }
      }
    }
  });

  it("is flatter than it is wide, so a layer reads as a disc and not a ball", () => {
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      const band = bandOf(layer);
      expect(band.ry / band.rx).toBeCloseTo(BAND_FLATTEN, 10);
      expect(BAND_FLATTEN).toBeLessThan(1);
    }
  });
});

describe("minX", () => {
  it("lets the back of the record cross under the headline", () => {
    expect(minX(LAYER_COUNT - 1)).toBeLessThan(RECORD_X);
  });

  it("holds the front clear of it", () => {
    expect(minX(0)).toBeGreaterThan(minX(LAYER_COUNT - 1));
    expect(minX(0)).toBeGreaterThanOrEqual(RECORD_X - 0.2);
  });

  it("falls the whole way back, so no layer is a gap in the guard", () => {
    for (let layer = 1; layer < LAYER_COUNT; layer += 1) {
      expect(minX(layer)).toBeLessThanOrEqual(minX(layer - 1) + 1e-9);
    }
  });

  it("clamps outside the layers rather than running away", () => {
    expect(minX(-3)).toBe(minX(0));
    expect(minX(40)).toBe(minX(LAYER_COUNT - 1));
  });
});

describe("placeAt", () => {
  it("is the layer and slot of the index", () => {
    expect(placeAt(7, "a")).toEqual(placeIn(1, 1, "a"));
  });

  it("grows wider toward the back, which is what makes the field a galaxy", () => {
    // The back band spans more of the volume than the front one, so the far
    // layers fill the frame behind the near ones instead of hiding behind them.
    expect(bandOf(LAYER_COUNT - 1).rx).toBeGreaterThan(bandOf(0).rx * 2);
  });
});
