/**
 * The ceiling on how often one pull request can provision a sandbox.
 *
 * Repo write already gates who may ask; this gates how often, which is the
 * half that a maintainer pasting six questions in a row would otherwise blow
 * straight through.
 */

import { describe, expect, it } from "vitest";
import { ConverseRateLimit } from "../../src/converse/rate-limit";

const at = (t: { now: number }) => ({ limit: 2, windowMs: 1000, now: () => t.now });

describe("ConverseRateLimit", () => {
  it("allows up to the limit inside the window, then says how long to wait", () => {
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
    limit.release("o/r", 7);
    t.now = 100;
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
    limit.release("o/r", 7);
    t.now = 200;
    const third = limit.take("o/r", 7);
    expect(third).toMatchObject({ allowed: false, reason: "too_many" });
    // The oldest question was at 0, so a slot frees at 1000.
    if (third.allowed) return;
    if (third.reason !== "too_many") return;
    expect(third.retryAfterMs).toBe(800);
  });

  it("lets the window slide rather than resetting it", () => {
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    limit.take("o/r", 7);
    limit.release("o/r", 7);
    t.now = 100;
    limit.take("o/r", 7);
    limit.release("o/r", 7);
    // The first has aged out; the second has not.
    t.now = 1050;
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
  });

  it("refuses a second question while one is in flight", () => {
    // Two sandboxes for one pull request at once is the thing the limit is
    // for, and a queue would only delay it.
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
    expect(limit.take("o/r", 7)).toEqual({ allowed: false, reason: "in_flight" });
    limit.release("o/r", 7);
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
  });

  it("counts one pull request's questions, not another's", () => {
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    limit.take("o/r", 7);
    limit.release("o/r", 7);
    limit.take("o/r", 7);
    limit.release("o/r", 7);
    expect(limit.take("o/r", 8)).toEqual({ allowed: true });
    expect(limit.take("other/repo", 7)).toEqual({ allowed: true });
  });

  it("treats two spellings of one repo as one budget", () => {
    // `repo` is whatever casing GitHub sent, and the store compares it
    // `COLLATE NOCASE` for the same reason.
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    limit.take("o/r", 7);
    limit.release("o/r", 7);
    limit.take("O/R", 7);
    limit.release("O/R", 7);
    expect(limit.take("o/R", 7)).toMatchObject({ allowed: false, reason: "too_many" });
  });

  it("a limit of one still admits the first question", () => {
    const t = { now: 0 };
    const limit = new ConverseRateLimit({ limit: 1, windowMs: 1000, now: () => t.now });
    expect(limit.take("o/r", 7)).toEqual({ allowed: true });
    limit.release("o/r", 7);
    expect(limit.take("o/r", 7)).toMatchObject({ allowed: false, reason: "too_many" });
  });

  it("release on a pull request it never saw does not create a slot", () => {
    const t = { now: 0 };
    const limit = new ConverseRateLimit(at(t));
    limit.release("o/r", 99);
    expect(limit.take("o/r", 99)).toEqual({ allowed: true });
  });
});
