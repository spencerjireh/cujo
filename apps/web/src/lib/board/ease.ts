/**
 * Easing, and the one function that makes it frame-rate independent.
 *
 * The chamber used to snap: focus set a scale of 1.55 in a single assignment,
 * and every other transition was either instant or a raw sine. Easing it is the
 * difference between an instrument that responds and one that switches.
 *
 * Pure and here rather than in a scene file, because `apps/web` runs vitest in
 * node with no DOM: nothing under `components/board/chamber/` can be tested at
 * all, so anything with a rule worth pinning belongs on this side of the line.
 */

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function clamp01(t: number): number {
  return clamp(t, 0, 1);
}

/** Fast out of the gate, settling at the end. What an arrival wants. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/** Symmetric, for a value that leaves and returns — a slide between slots. */
export function easeInOutSine(t: number): number {
  return (1 - Math.cos(Math.PI * clamp01(t))) / 2;
}

/**
 * Exponential approach toward a target, independent of frame rate.
 *
 * The naive form of this — `current + (target - current) * rate` — is the bug
 * it exists to avoid: it moves a fixed *fraction* per frame, so the same hover
 * settles at one speed on a 60 Hz display and nearly twice as fast on a 144 Hz
 * one. Raising the decay to the power of elapsed time is what makes two half
 * steps equal one whole step, which is the property the test pins.
 *
 * `rate` is the decay per second: how much of the remaining distance is still
 * left after one second. Smaller is faster.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0) return current;
  // A rate outside this range is either instant or divergent; both are bugs at
  // the call site rather than states to interpolate through.
  const decay = clamp(rate, 0, 1) ** dt;
  return target + (current - target) * decay;
}
