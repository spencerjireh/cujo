import { LAYER_CAPACITY, layerOf } from "@/lib/board/galaxy";
import {
  SECONDS_PER_RUN,
  WASH_MIN_SECONDS,
  WASH_SPAN,
  lightOpacity,
  readStrength,
  washCursor,
  washPhase,
  washSeconds,
} from "@/lib/board/wash";
import { describe, expect, it } from "vitest";

/**
 * The wash is the board re-reading the API (decision 68). Since decision 72 it
 * walks the record run by run rather than crossing it as a plane.
 *
 * The claims worth asserting are the ones nobody can check by looking: that
 * it reads the record **oldest first**, a run or two at a time, and finishes
 * one layer before it begins the next.
 */

const COUNT = LAYER_CAPACITY.reduce((sum, n) => sum + n, 0);
const INDICES = Array.from({ length: COUNT }, (_, i) => i);

describe("washPhase", () => {
  it("reports nothing before the first poll has landed", () => {
    expect(washPhase(3, -1, 5)).toBeNull();
  });

  it("runs 0 to 1 across the interval it was given", () => {
    expect(washPhase(10, 10, 5)).toBe(0);
    expect(washPhase(12.5, 10, 5)).toBe(0.5);
    expect(washPhase(15, 10, 5)).toBe(1);
  });

  it("ends rather than looping once the wash is over", () => {
    // The wash is the read, not a timer: it waits for the next one.
    expect(washPhase(16, 10, 5)).toBeNull();
  });

  it("reports nothing for an interval of no length", () => {
    expect(washPhase(10, 10, 0)).toBeNull();
  });
});

describe("washSeconds", () => {
  it("never goes under the floor", () => {
    expect(washSeconds(5000, 1)).toBe(WASH_MIN_SECONDS);
    expect(washSeconds(0, 0)).toBe(WASH_MIN_SECONDS);
  });

  it("gives every star its time on a full board", () => {
    expect(washSeconds(5000, COUNT)).toBe(SECONDS_PER_RUN * COUNT);
  });

  it("lasts the whole poll interval when that is longer", () => {
    expect(washSeconds(60000, 3)).toBe(60);
  });
});

describe("lightOpacity", () => {
  it("is full anywhere between the oldest run and the newest", () => {
    expect(lightOpacity(0, COUNT)).toBe(1);
    expect(lightOpacity(COUNT - 1, COUNT)).toBe(1);
    expect(lightOpacity(COUNT / 2, COUNT)).toBe(1);
  });

  it("fades in as the cursor arrives at the oldest run", () => {
    expect(lightOpacity(washCursor(0, COUNT), COUNT)).toBe(0);
    const arriving = lightOpacity(COUNT - 1 + 1, COUNT);
    expect(arriving).toBeGreaterThan(0);
    expect(arriving).toBeLessThan(1);
  });

  it("fades out as the cursor leaves the newest run", () => {
    expect(lightOpacity(washCursor(1, COUNT), COUNT)).toBe(0);
    expect(lightOpacity(-0.5, COUNT)).toBe(0.5);
  });

  it("never returns an opacity outside 0 to 1", () => {
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const value = lightOpacity(washCursor(phase, COUNT), COUNT);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("washCursor", () => {
  it("starts past the oldest run and finishes past the newest", () => {
    // Both ends overshoot, so the first and last runs get a full read rather
    // than half of one.
    expect(washCursor(0, COUNT)).toBeGreaterThan(COUNT - 1);
    expect(washCursor(1, COUNT)).toBeLessThan(0);
  });

  it("only ever travels toward the newest run", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const cursor = washCursor(phase, COUNT);
      expect(cursor).toBeLessThan(previous);
      previous = cursor;
    }
  });

  it("clamps outside the interval rather than running on", () => {
    expect(washCursor(-2, COUNT)).toBe(washCursor(0, COUNT));
    expect(washCursor(4, COUNT)).toBe(washCursor(1, COUNT));
  });

  it("still walks a record of one run, and of none", () => {
    expect(washCursor(0, 1)).toBeGreaterThan(0);
    expect(washCursor(1, 1)).toBeLessThan(0);
    expect(washCursor(0, 0)).toBeGreaterThan(washCursor(1, 0));
  });
});

describe("readStrength", () => {
  it("peaks where the cursor meets the run", () => {
    expect(readStrength(7, 7)).toBe(1);
  });

  it("reads nothing far ahead of the cursor or far behind it", () => {
    expect(readStrength(7, 3)).toBe(0);
    expect(readStrength(7, 12)).toBe(0);
  });

  it("rises sharply into the cursor and settles slowly behind it", () => {
    // A run the cursor has not reached is anticipating; one it has passed has
    // just been read. Those are different events and are drawn differently.
    const ahead = readStrength(7, 6.85);
    const behind = readStrength(7, 7.15);
    expect(behind).toBeGreaterThan(ahead);
  });

  it("never returns a strength outside 0 to 1", () => {
    for (let delta = -3; delta <= 3; delta += 0.01) {
      const value = readStrength(7, 7 + delta);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("the wash reads the record one run at a time, oldest first", () => {
  it("lights at most two runs strongly at once, and they are neighbours", () => {
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const cursor = washCursor(phase, COUNT);
      const lit = INDICES.filter((i) => readStrength(cursor, i) > 0.5);
      expect(lit.length).toBeLessThanOrEqual(2);
      if (lit.length === 2) expect((lit[1] ?? 0) - (lit[0] ?? 0)).toBe(1);
    }
  });

  it("reads every run at some point in the walk", () => {
    const peaks = INDICES.map(() => 0);
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const cursor = washCursor(phase, COUNT);
      for (const i of INDICES) peaks[i] = Math.max(peaks[i] ?? 0, readStrength(cursor, i));
    }
    for (const peak of peaks) expect(peak).toBeGreaterThan(0.9);
  });

  it("finishes one layer before it begins the next, back to front", () => {
    // When each run peaks, in phase. Index order is age order and the layers
    // are contiguous in it, so the back layer's last run must peak before the
    // middle layer's first, and so on toward the front.
    const peakAt = INDICES.map(() => 0);
    const peak = INDICES.map(() => 0);
    for (let phase = 0; phase <= 1; phase += 0.002) {
      const cursor = washCursor(phase, COUNT);
      for (const i of INDICES) {
        const read = readStrength(cursor, i);
        if (read > (peak[i] ?? 0)) {
          peak[i] = read;
          peakAt[i] = phase;
        }
      }
    }
    for (let layer = LAYER_CAPACITY.length - 1; layer > 0; layer -= 1) {
      const thisLayer = INDICES.filter((i) => layerOf(i).layer === layer);
      const nextLayer = INDICES.filter((i) => layerOf(i).layer === layer - 1);
      const lastOfThis = Math.max(...thisLayer.map((i) => peakAt[i] ?? 0));
      const firstOfNext = Math.min(...nextLayer.map((i) => peakAt[i] ?? 0));
      expect(lastOfThis).toBeLessThan(firstOfNext);
    }
  });

  /**
   * Why the property above holds, stated as arithmetic rather than as a walk
   * of a particular record: the lit window is narrower than two runs.
   */
  it("keeps its lit window under two runs wide", () => {
    expect(WASH_SPAN).toBeLessThan(2);
  });
});
