import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The stylesheet is a file, not a module with behaviour jsdom can exercise:
// `overscroll-behavior` is nothing jsdom computes, so what a test can hold
// the file to is the declaration itself (decision 98). These checks fail the
// moment the property leaves either root rule — the regression that matters,
// a bounce or a pull-to-refresh coming back — and the third holds the reason
// the value is `-y` and not the shorthand: horizontal overscroll is the
// browser's back and forward gesture, and the page has no claim on it.
const css = readFileSync(
  fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)),
  "utf8",
);

/** The declarations of the stylesheet's only `selector` rule. */
function rule(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match?.[1]) throw new Error(`globals.css has no ${selector} rule`);
  return match[1];
}

describe("the root scroller does not bounce (decision 98)", () => {
  it("html turns the vertical overscroll off", () => {
    expect(rule("html")).toContain("overscroll-behavior-y: none");
  });

  it("body turns the vertical overscroll off", () => {
    expect(rule("body")).toContain("overscroll-behavior-y: none");
  });

  it("neither root touches the horizontal overscroll", () => {
    expect(rule("html")).not.toContain("overscroll-behavior-x");
    expect(rule("body")).not.toContain("overscroll-behavior-x");
  });
});
