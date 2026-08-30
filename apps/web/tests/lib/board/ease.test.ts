import { approach, clamp, clamp01, easeInOutSine, easeOutCubic } from "@/lib/board/ease";
import { describe, expect, it } from "vitest";

describe("clamp", () => {
  it("holds a value inside its bounds", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe("easing curves", () => {
  it("runs from 0 to 1 across the unit interval", () => {
    for (const ease of [easeOutCubic, easeInOutSine]) {
      expect(ease(0)).toBeCloseTo(0, 6);
      expect(ease(1)).toBeCloseTo(1, 6);
    }
  });

  it("never goes backwards", () => {
    for (const ease of [easeOutCubic, easeInOutSine]) {
      let previous = Number.NEGATIVE_INFINITY;
      for (let t = 0; t <= 1.00001; t += 0.02) {
        const value = ease(t);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("clamps outside the interval rather than overshooting", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeInOutSine(2)).toBeCloseTo(1, 6);
  });

  it("leaves fast and settles, which is what an arrival wants", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("approach", () => {
  /**
   * The property the whole function exists for. A fixed fraction per frame
   * settles at one speed on a 60 Hz display and nearly twice as fast on a
   * 144 Hz one; two half-steps have to equal one whole step.
   */
  it("moves the same distance per second at any frame rate", () => {
    const rate = 0.02;
    const oneStep = approach(0, 1, rate, 1 / 30);
    let twoSteps = approach(0, 1, rate, 1 / 60);
    twoSteps = approach(twoSteps, 1, rate, 1 / 60);
    expect(twoSteps).toBeCloseTo(oneStep, 10);

    let sixty = 0;
    for (let i = 0; i < 60; i += 1) sixty = approach(sixty, 1, rate, 1 / 60);
    let onehundred = 0;
    for (let i = 0; i < 144; i += 1) onehundred = approach(onehundred, 1, rate, 1 / 144);
    expect(sixty).toBeCloseTo(onehundred, 10);
  });

  it("closes on the target without passing it", () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = approach(value, 1, 0.02, 1 / 60);
    expect(value).toBeGreaterThan(0.999);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("works in both directions", () => {
    expect(approach(1, 0, 0.02, 1)).toBeCloseTo(0.02, 6);
    expect(approach(0, 1, 0.02, 1)).toBeCloseTo(0.98, 6);
  });

  it("does not move on a frame that took no time", () => {
    expect(approach(0.3, 1, 0.02, 0)).toBe(0.3);
    expect(approach(0.3, 1, 0.02, -1)).toBe(0.3);
  });
});
