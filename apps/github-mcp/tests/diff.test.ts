import { describe, expect, it } from "vitest";
import { appendMovedComments, parseDiffLines, validateAnchors } from "../src/diff";

const PATCH = [
  "@@ -10,4 +10,5 @@ def total(order):",
  "     subtotal = sum(order.lines)",
  "-    return round(subtotal, 2)",
  "+    tax = subtotal * 0.1",
  "+    return round(subtotal + tax, 1)",
  "     # end",
  "@@ -40,2 +41,2 @@",
  "-old = 1",
  "+new = 1",
  " ctx",
  "\\ No newline at end of file",
].join("\n");

describe("parseDiffLines", () => {
  it("assigns context lines to both sides and +/- lines to one side", () => {
    const lines = parseDiffLines(PATCH);
    expect([...lines.left].sort((a, b) => a - b)).toEqual([10, 11, 12, 40, 41]);
    expect([...lines.right].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 41, 42]);
  });

  it("does not count the trailing newline of a patch as a context line", () => {
    const lines = parseDiffLines(`${PATCH}\n`);
    expect(lines.left.has(42)).toBe(false);
    expect(lines.right.has(43)).toBe(false);
    expect(lines.left.size).toBe(5);
    expect(lines.right.size).toBe(6);
  });

  it("stops counting once a hunk's declared line counts are exhausted", () => {
    const lines = parseDiffLines("@@ -1,1 +1,1 @@\n a\n\n stray\n");
    expect([...lines.left]).toEqual([1]);
    expect([...lines.right]).toEqual([1]);
  });

  it("returns empty sets for a missing patch", () => {
    const lines = parseDiffLines(undefined);
    expect(lines.left.size).toBe(0);
    expect(lines.right.size).toBe(0);
  });
});

describe("validateAnchors", () => {
  const files = [{ filename: "app/orders.py", patch: PATCH }, { filename: "image.png" }];

  it("keeps a comment on a line present on the requested side", () => {
    const { inline, moved } = validateAnchors(files, [
      { path: "app/orders.py", line: 12, body: "rounding changed" },
      { path: "app/orders.py", line: 11, side: "LEFT", body: "removed rounding" },
    ]);
    expect(inline).toEqual([
      { path: "app/orders.py", line: 12, side: "RIGHT", body: "rounding changed" },
      { path: "app/orders.py", line: 11, side: "LEFT", body: "removed rounding" },
    ]);
    expect(moved).toEqual([]);
  });

  it("moves a comment whose line, side, or path is not in the diff", () => {
    const comments = [
      { path: "app/orders.py", line: 99, body: "outside hunks" },
      { path: "app/orders.py", line: 13, side: "LEFT" as const, body: "only on RIGHT" },
      { path: "missing.py", line: 1, body: "file not in PR" },
      { path: "image.png", line: 1, body: "binary" },
    ];
    const { inline, moved } = validateAnchors(files, comments);
    expect(inline).toEqual([]);
    // The rendered section is unchanged; only the shape carrying it grew.
    expect(moved.map((m) => m.comment)).toEqual(comments);
  });
});

describe("appendMovedComments", () => {
  it("leaves the body alone when nothing moved", () => {
    expect(appendMovedComments("Summary\n", [])).toBe("Summary\n");
  });

  it("adds a section listing each moved finding", () => {
    const body = appendMovedComments("Summary", [
      { comment: { path: "a.py", line: 3, body: "thing" }, reason: "file_not_in_diff" },
      {
        comment: { path: "b.py", line: 8, side: "LEFT", body: "other" },
        reason: "line_not_in_hunk",
      },
    ]);
    expect(body).toBe(
      "Summary\n\n### Findings without a diff anchor\n\n- `a.py:3` (RIGHT): thing\n- `b.py:8` (LEFT): other\n",
    );
  });
});
