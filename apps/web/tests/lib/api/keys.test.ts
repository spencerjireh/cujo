/**
 * The cache keys, now that there is one plane to key.
 *
 * The mode used to be part of every key, because `reduceRun` returns the
 * *previous* cached object when a snapshot repeats and an entry filled on the
 * operator plane — approver and all — could otherwise be handed to a public
 * render (decision 34). Decision 52 deleted that plane, so what is left worth
 * pinning is the shape: everything stays under `all`, so one invalidation
 * still reaches the list and every detail.
 */

import { describe, expect, it } from "vitest";
import { runStreamUrl } from "../../../src/lib/api/client";
import { runKeys } from "../../../src/lib/api/keys";

describe("runKeys", () => {
  it("gives the list and a detail different keys", () => {
    expect(runKeys.list()).not.toEqual(runKeys.detail("r1"));
    expect(runKeys.detail("r1")).not.toEqual(runKeys.detail("r2"));
  });

  it("keeps everything under `all`, so one invalidation still reaches it", () => {
    for (const key of [runKeys.list(), runKeys.detail("r1")]) {
      expect(key.slice(0, runKeys.all.length)).toEqual([...runKeys.all]);
    }
  });
});

describe("runStreamUrl", () => {
  /**
   * A fixed path rather than a `?mode=` parameter. There is nothing else to
   * ask for since decision 52, but the rule is kept: a query string is
   * something the browser controls, and the stream URL is not.
   */
  it("points at the one proxy route", () => {
    expect(runStreamUrl("r1")).toBe("/api/public/runs/r1/events");
  });

  it("encodes the id", () => {
    expect(runStreamUrl("a/b")).toBe("/api/public/runs/a%2Fb/events");
  });
});
