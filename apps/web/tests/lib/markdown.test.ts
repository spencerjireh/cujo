/**
 * The sanitizer's policy, and the markdown parse that feeds it.
 *
 * `sanitize` itself is not exercised here: DOMPurify needs a real DOM and this
 * suite runs in node by design (see vitest.config.ts), so calling it throws
 * rather than sanitizing. What is asserted instead is the policy that decides
 * what survives — a list, and therefore a thing a test can hold — plus the
 * parse that produces the HTML it judges. The end-to-end behaviour is covered
 * by the Storybook stories, which run in a browser.
 */

import { ALLOWED_ATTR, ALLOWED_TAGS, toHtml } from "@/lib/markdown";
import { describe, expect, it } from "vitest";

describe("the sanitizer allowlist", () => {
  it("admits the folds the review body is composed with", () => {
    // decision 74: `github-mcp` wraps the evidence and the machine-readable
    // block in <details>. Without these two the board showed both expanded and
    // unlabelled, which is the one place the composed body would read worse.
    expect(ALLOWED_TAGS).toContain("details");
    expect(ALLOWED_TAGS).toContain("summary");
  });

  it("does not admit `open`, so a body cannot force a fold open here", () => {
    // Absent, every fold renders collapsed on the board exactly as it does on
    // GitHub. Present, a review could push a wall of JSON into the page.
    expect(ALLOWED_ATTR).not.toContain("open");
  });

  it("still admits nothing that runs, loads, or collects", () => {
    for (const tag of ["script", "iframe", "form", "input", "style", "img", "object", "svg"]) {
      expect(ALLOWED_TAGS).not.toContain(tag);
    }
    expect(ALLOWED_ATTR).toEqual(["href", "title"]);
  });
});

describe("toHtml", () => {
  it("passes a composed fold through as markup for the sanitizer to judge", () => {
    const html = toHtml(
      "<details>\n<summary>Machine-readable summary</summary>\n\n`x`\n\n</details>",
    );
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>Machine-readable summary</summary>");
  });

  it("renders the composed body's tables and blockquotes", () => {
    const html = toHtml("| host | known |\n| --- | --- |\n| `pypi.org` | yes |\n\n> evidence");
    expect(html).toContain("<table>");
    expect(html).toContain("<blockquote>");
  });
});
