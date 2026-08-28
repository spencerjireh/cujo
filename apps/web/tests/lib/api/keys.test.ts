/**
 * The mode belongs in the query key, and not for tidiness.
 *
 * `reduceRun` returns the *previous* cached object when a snapshot repeats, so
 * an entry filled on the operator plane — approver and all — would be handed
 * straight to a public render if the two planes could ever share a key. They
 * cannot (decision 34).
 */

import { describe, expect, it } from "vitest";
import { runStreamUrl } from "../../../src/lib/api/client";
import { runKeys } from "../../../src/lib/api/keys";

describe("runKeys", () => {
  it("gives the two planes different keys for the same run", () => {
    expect(runKeys.detail("public", "r1")).not.toEqual(runKeys.detail("operator", "r1"));
    expect(runKeys.list("public")).not.toEqual(runKeys.list("operator"));
  });

  it("keeps both planes under `all`, so one invalidation still reaches everything", () => {
    for (const key of [runKeys.list("public"), runKeys.detail("operator", "r1")]) {
      expect(key.slice(0, runKeys.all.length)).toEqual([...runKeys.all]);
    }
  });
});

describe("runStreamUrl", () => {
  /**
   * Separate routes rather than one route with a `?mode=` parameter: a query
   * string is something the browser controls.
   */
  it("points each plane at its own proxy route", () => {
    expect(runStreamUrl("public", "r1")).toBe("/api/public/runs/r1/events");
    expect(runStreamUrl("operator", "r1")).toBe("/api/runs/r1/events");
  });

  it("encodes the id", () => {
    expect(runStreamUrl("public", "a/b")).toBe("/api/public/runs/a%2Fb/events");
  });
});
