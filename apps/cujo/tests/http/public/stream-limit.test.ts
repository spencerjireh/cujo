/**
 * The counter on its own, away from any route.
 *
 * `index.test.ts` proves the cap through a real request, which is the test that
 * matters; this one covers the arithmetic that test cannot reach — a release
 * with no acquire, a limit of one, exhaustion and recovery — and it is where a
 * failure points straight at the counter rather than at the SSE plumbing.
 */

import { describe, expect, it } from "vitest";
import { createStreamLimit } from "../../../src/http/public/stream-limit";

describe("createStreamLimit", () => {
  it("hands out exactly `max` slots and then refuses", () => {
    const limit = createStreamLimit(2);
    expect(limit.acquire()).toBe(true);
    expect(limit.acquire()).toBe(true);
    expect(limit.acquire()).toBe(false);
    expect(limit.active()).toBe(2);
  });

  it("frees a slot on release, and takes it again", () => {
    const limit = createStreamLimit(1);
    expect(limit.acquire()).toBe(true);
    expect(limit.acquire()).toBe(false);
    limit.release();
    expect(limit.active()).toBe(0);
    expect(limit.acquire()).toBe(true);
  });

  /**
   * The handler releases in a `finally`, which runs once per stream — but a
   * counter that could be driven below zero would invent capacity, and the cap
   * would then be silently larger than configured for the rest of the process's
   * life.
   */
  it("cannot be driven below zero, however many times release is called", () => {
    const limit = createStreamLimit(1);
    limit.release();
    limit.release();
    expect(limit.active()).toBe(0);
    expect(limit.acquire()).toBe(true);
    expect(limit.acquire()).toBe(false);
  });

  it("refuses everything when the cap is zero", () => {
    const limit = createStreamLimit(0);
    expect(limit.acquire()).toBe(false);
    expect(limit.active()).toBe(0);
  });

  /**
   * One counter per app instance, never module state: two instances sharing a
   * count would make the cap depend on how many times the app was constructed,
   * which in this suite is once per test.
   */
  it("keeps each instance's count to itself", () => {
    const a = createStreamLimit(1);
    const b = createStreamLimit(1);
    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(true);
    expect(a.active()).toBe(1);
    expect(b.active()).toBe(1);
  });
});
