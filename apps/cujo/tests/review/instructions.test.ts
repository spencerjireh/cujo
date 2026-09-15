import { describe, expect, it, vi } from "vitest";
import { INSTRUCTIONS_BYTES, readInstructions } from "../../src/review/instructions";

function github(files: Record<string, string | null>) {
  return { readFile: vi.fn(async (_repo: string, path: string) => files[path] ?? null) };
}

describe("readInstructions (decision 155)", () => {
  it("prefers the file at base, falls back to the board, and is null with neither", async () => {
    const board = { get: () => ({ mode: null, instructions: "From the board.", updatedAt: "t" }) };
    expect(
      await readInstructions(
        github({ ".cujo/REVIEW.md": "From the file.\n" }),
        board,
        "o/r",
        "base",
      ),
    ).toEqual({
      source: "file",
      text: "From the file.\n",
      truncated: false,
    });
    expect(await readInstructions(github({}), board, "o/r", "base")).toEqual({
      source: "board",
      text: "From the board.",
      truncated: false,
    });
    // An empty file is no file.
    expect(
      await readInstructions(github({ ".cujo/REVIEW.md": "  \n" }), board, "o/r", "base"),
    ).toMatchObject({ source: "board" });
    expect(await readInstructions(github({}), undefined, "o/r", "base")).toBeNull();
    expect(
      await readInstructions(
        github({}),
        { get: () => ({ mode: null, instructions: "  ", updatedAt: null }) },
        "o/r",
        "base",
      ),
    ).toBeNull();
  });

  it("cuts a long text on a line at the cap and says so", async () => {
    const long = `${"a".repeat(INSTRUCTIONS_BYTES - 10)}\n${"b".repeat(100)}`;
    const read = await readInstructions(
      github({ ".cujo/REVIEW.md": long }),
      undefined,
      "o/r",
      "base",
    );
    expect(read?.truncated).toBe(true);
    expect(read?.text.endsWith("a")).toBe(true);
  });

  it("reads at the ref it was given", async () => {
    const g = github({});
    await readInstructions(g, undefined, "o/r", "base-sha");
    expect(g.readFile).toHaveBeenCalledWith("o/r", ".cujo/REVIEW.md", "base-sha");
  });
});
