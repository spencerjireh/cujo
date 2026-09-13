import { describe, expect, it } from "vitest";
import type { PullRequestFile } from "../../src/clients/github";
import { compressDiff, rankOf } from "../../src/review/compress";

function file(path: string, patch: string | null, extra: Partial<PullRequestFile> = {}) {
  return { path, status: "modified", additions: 1, deletions: 0, patch, ...extra };
}

describe("rankOf", () => {
  it("reads source first, then prose, then generated files, then lockfiles", () => {
    expect(rankOf("src/a.ts")).toBe(0);
    expect(rankOf("README.md")).toBe(1);
    expect(rankOf("docs/spec.md")).toBe(1);
    expect(rankOf("dist/index.js")).toBe(2);
    expect(rankOf("vendor/lib.py")).toBe(2);
    expect(rankOf("tests/__snapshots__/a.snap")).toBe(2);
    expect(rankOf("web/app.min.js")).toBe(2);
    expect(rankOf("pnpm-lock.yaml")).toBe(3);
    expect(rankOf("services/api/uv.lock")).toBe(3);
  });

  it("is not fooled by a manifest that looks like prose", () => {
    // `requirements.txt` is a manifest, not documentation, and reads first.
    expect(rankOf("requirements.txt")).toBe(0);
  });
});

describe("compressDiff", () => {
  it("keeps whole files in rank order, then GitHub's order, under the cap", () => {
    const out = compressDiff(
      [
        file("README.md", "a".repeat(10)),
        file("src/b.ts", "b".repeat(10)),
        file("src/a.ts", "c".repeat(10)),
        file("pnpm-lock.yaml", "d".repeat(10)),
      ],
      35,
    );
    expect(out.kept.map((f) => f.path)).toEqual(["src/b.ts", "src/a.ts", "README.md"]);
    expect(out.omitted).toEqual([
      {
        path: "pnpm-lock.yaml",
        status: "modified",
        additions: 1,
        deletions: 0,
        reason: "over_cap",
      },
    ]);
    expect(out.bytes).toBe(30);
    expect(out.cap).toBe(35);
  });

  it("never cuts a hunk, and a file that does not fit does not block a smaller one", () => {
    // 30 fits; 80 does not; 20 still does. Whole files or nothing.
    const out = compressDiff(
      [file("a.ts", "x".repeat(30)), file("b.ts", "y".repeat(80)), file("c.ts", "z".repeat(20))],
      60,
    );
    expect(out.kept.map((f) => f.path)).toEqual(["a.ts", "c.ts"]);
    expect(out.omitted.map((f) => [f.path, f.reason])).toEqual([["b.ts", "over_cap"]]);
    expect(out.kept.every((f) => f.patch.length === (f.path === "a.ts" ? 30 : 20))).toBe(true);
  });

  it("lists a file with no patch as no_patch and spends nothing on it", () => {
    const out = compressDiff(
      [file("logo.png", null, { status: "added", additions: 0 }), file("a.ts", "abc")],
      3,
    );
    expect(out.kept.map((f) => f.path)).toEqual(["a.ts"]);
    expect(out.omitted).toEqual([
      { path: "logo.png", status: "added", additions: 0, deletions: 0, reason: "no_patch" },
    ]);
    expect(out.bytes).toBe(3);
  });

  it("counts bytes, not characters", () => {
    const out = compressDiff([file("a.ts", "é")], 1);
    expect(out.kept).toEqual([]);
    expect(out.omitted[0]?.reason).toBe("over_cap");
  });

  it("is empty for an empty diff", () => {
    expect(compressDiff([], 100)).toEqual({ kept: [], omitted: [], bytes: 0, cap: 100 });
  });
});
