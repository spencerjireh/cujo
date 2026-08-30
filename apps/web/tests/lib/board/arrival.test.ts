import { arrivalCurve, diffRecord, slideProgress } from "@/lib/board/arrival";
import { describe, expect, it } from "vitest";

describe("diffRecord", () => {
  it("says nothing changed when the record is the same", () => {
    expect(diffRecord(["a", "b", "c"], ["a", "b", "c"])).toEqual({ kind: "same" });
  });

  it("says nothing changed for two empty records", () => {
    expect(diffRecord([], [])).toEqual({ kind: "same" });
  });

  it("draws the first record outright rather than animating it in", () => {
    // A 24-specimen cascade on first paint would be an ornament.
    expect(diffRecord([], ["a", "b"])).toEqual({ kind: "rebuild" });
  });

  it("sees one run land at the head", () => {
    expect(diffRecord(["a", "b"], ["new", "a", "b"])).toEqual({
      kind: "advance",
      entering: ["new"],
      leaving: [],
      shift: 1,
    });
  });

  it("sees two runs land between polls", () => {
    expect(diffRecord(["a", "b"], ["x", "y", "a", "b"])).toEqual({
      kind: "advance",
      entering: ["x", "y"],
      leaving: [],
      shift: 2,
    });
  });

  it("names the run pushed off the end of the chamber", () => {
    // The chamber holds a fixed number; the record below still lists them all.
    expect(diffRecord(["a", "b", "c"], ["new", "a", "b"])).toEqual({
      kind: "advance",
      entering: ["new"],
      leaving: ["c"],
      shift: 1,
    });
  });

  it("rebuilds when the order changed rather than advanced", () => {
    expect(diffRecord(["a", "b", "c"], ["a", "c", "b"])).toEqual({ kind: "rebuild" });
  });

  it("rebuilds when a run was removed from the middle", () => {
    expect(diffRecord(["a", "b", "c"], ["a", "c"])).toEqual({ kind: "rebuild" });
  });

  it("rebuilds when the record was replaced entirely", () => {
    expect(diffRecord(["a", "b"], ["x", "y"])).toEqual({ kind: "rebuild" });
  });

  it("rebuilds when the newest run went away", () => {
    // Not an advance in either direction: the head the old record was anchored
    // on is gone, so there is nothing to slide.
    expect(diffRecord(["a", "b"], ["b"])).toEqual({ kind: "rebuild" });
  });

  it("rebuilds an emptied record", () => {
    expect(diffRecord(["a"], [])).toEqual({ kind: "rebuild" });
  });
});

describe("arrivalCurve", () => {
  it("starts in front of the slot, small and invisible", () => {
    const start = arrivalCurve(0);
    expect(start.lead).toBeGreaterThan(0);
    expect(start.scale).toBeLessThan(0.3);
    expect(start.opacity).toBe(0);
  });

  it("ends in the slot at full size", () => {
    const end = arrivalCurve(1);
    expect(end.lead).toBeCloseTo(0, 6);
    expect(end.scale).toBeCloseTo(1, 6);
    expect(end.opacity).toBe(1);
  });

  it("is solid before it has finished moving", () => {
    // Otherwise the shape is still fading while it settles, which reads as two
    // separate events rather than one arrival.
    const mid = arrivalCurve(0.6);
    expect(mid.opacity).toBe(1);
    expect(mid.lead).toBeGreaterThan(0);
  });

  it("never overshoots on either side of the interval", () => {
    for (const t of [-1, 0, 0.5, 1, 2]) {
      const value = arrivalCurve(t);
      expect(value.lead).toBeGreaterThanOrEqual(0);
      expect(value.scale).toBeLessThanOrEqual(1);
      expect(value.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("slideProgress", () => {
  it("runs from 0 to 1 across the slide", () => {
    expect(slideProgress(10, 10, 2)).toBe(0);
    expect(slideProgress(10, 11, 2)).toBe(0.5);
    expect(slideProgress(10, 12, 2)).toBe(1);
  });

  it("lands rather than running past, however stale the start", () => {
    expect(slideProgress(10, 900, 2)).toBe(1);
  });

  it("is finished immediately when there is no duration to run", () => {
    expect(slideProgress(10, 10, 0)).toBe(1);
  });
});
