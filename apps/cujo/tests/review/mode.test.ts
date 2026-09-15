import { describe, expect, it } from "vitest";
import { type ModeInputs, resolveMode } from "../../src/review/mode";

const plain: ModeInputs = {
  deployDefault: "sandbox",
  declared: null,
  manifestChanged: false,
  authorIsBot: false,
};

describe("resolveMode", () => {
  it("falls back to the deploy default when the repo declares nothing", () => {
    expect(resolveMode(plain)).toEqual({ mode: "sandbox", reason: "deploy_default" });
    expect(resolveMode({ ...plain, deployDefault: "diff" })).toEqual({
      mode: "diff",
      reason: "deploy_default",
    });
  });

  it("puts the board between the deploy default and the file (decision 155)", () => {
    expect(resolveMode({ ...plain, board: "diff" })).toEqual({ mode: "diff", reason: "board" });
    expect(resolveMode({ ...plain, board: "diff", declared: "sandbox" })).toEqual({
      mode: "sandbox",
      reason: "declared",
    });
    expect(resolveMode({ ...plain, board: null })).toEqual({
      mode: "sandbox",
      reason: "deploy_default",
    });
  });

  it("lets the repository's declaration override the deploy default either way", () => {
    expect(resolveMode({ ...plain, declared: "diff" })).toEqual({
      mode: "diff",
      reason: "declared",
    });
    expect(resolveMode({ ...plain, deployDefault: "diff", declared: "sandbox" })).toEqual({
      mode: "sandbox",
      reason: "declared",
    });
  });

  it("floors a manifest change to the sandbox whatever anyone declared", () => {
    expect(
      resolveMode({ ...plain, deployDefault: "diff", declared: "diff", manifestChanged: true }),
    ).toEqual({ mode: "sandbox", reason: "manifest_floor" });
  });

  it("floors a Bot author to the sandbox, after the manifest floor", () => {
    expect(resolveMode({ ...plain, declared: "diff", authorIsBot: true })).toEqual({
      mode: "sandbox",
      reason: "bot_floor",
    });
    expect(resolveMode({ ...plain, manifestChanged: true, authorIsBot: true }).reason).toBe(
      "manifest_floor",
    );
  });
});
