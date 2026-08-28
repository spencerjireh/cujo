import { describe, expect, it } from "vitest";
import { appendRunFooter } from "../src/body";

const URL = "https://cujo.example.com/runs/8f3a2c1e";

describe("appendRunFooter", () => {
  it("appends a rule and the link", () => {
    expect(appendRunFooter("**What ran**\n\n212 tests.", URL)).toBe(
      `**What ran**\n\n212 tests.\n\n---\n\nFull evidence: ${URL}\n`,
    );
  });

  it("leaves the body byte-identical when there is no run url", () => {
    // This is the private-repo case. A review on a repo with no public page
    // must be exactly what it was before the footer existed.
    const body = "**What ran**\n\n212 tests.";
    expect(appendRunFooter(body, undefined)).toBe(body);
    expect(appendRunFooter(body, "")).toBe(body);
  });

  it("does not add a blank line to a body that already ends in one", () => {
    expect(appendRunFooter("Results.\n\n\n", URL)).toBe(
      `Results.\n\n---\n\nFull evidence: ${URL}\n`,
    );
  });

  it("lands after the anchorless findings block", () => {
    // The composition order in postReview is appendRunFooter(appendMovedComments(...)),
    // so the footer must be last, not wedged between the body and the findings.
    const withMoved = "Body.\n\n### Findings without a diff anchor\n\n- `a.ts:1` (RIGHT): x\n";
    const out = appendRunFooter(withMoved, URL);
    expect(out.indexOf("Full evidence")).toBeGreaterThan(out.indexOf("without a diff anchor"));
    expect(out.endsWith(`Full evidence: ${URL}\n`)).toBe(true);
  });
});
