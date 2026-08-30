import {
  DOC_GROUPS,
  DOC_ORDER,
  DOC_OVERVIEW,
  DOC_SLUGS,
  docPage,
  neighbours,
} from "@/lib/docs/nav";
import { describe, expect, it } from "vitest";

/**
 * The nav is the manual's only ordering, and four different readers use it —
 * the sidebar, the prev/next pair, `generateStaticParams` and every page's
 * metadata. So the invariants those readers assume are asserted here rather
 * than discovered as a broken link.
 */
describe("doc nav", () => {
  it("flattens every group into reading order, once each", () => {
    const fromGroups = DOC_GROUPS.flatMap((group) => group.pages);
    expect(DOC_ORDER).toEqual(fromGroups);
    expect(new Set(DOC_ORDER).size).toBe(DOC_ORDER.length);
  });

  it("gives every page a unique href", () => {
    const hrefs = DOC_ORDER.map((page) => page.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("has exactly one page without a slug, and it is the overview", () => {
    const rootless = DOC_ORDER.filter((page) => page.slug === null);
    expect(rootless).toEqual([DOC_OVERVIEW]);
    expect(DOC_OVERVIEW.href).toBe("/docs");
  });

  it("derives every other href from its slug", () => {
    for (const page of DOC_ORDER) {
      if (page.slug === null) continue;
      expect(page.href).toBe(`/docs/${page.slug}`);
      // Kebab-case: a slug is a URL somebody types and a filename somebody
      // greps for, and neither wants a capital or an underscore.
      expect(page.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("gives every page a title and a summary", () => {
    for (const page of DOC_ORDER) {
      expect(page.title.length).toBeGreaterThan(0);
      // The summary is the meta description as well as the page's own subtitle,
      // so an empty one is a page that previews as nothing.
      expect(page.summary.length).toBeGreaterThan(20);
    }
  });

  it("lists every slug but the overview's", () => {
    expect(DOC_SLUGS).toEqual(DOC_ORDER.map((p) => p.slug).filter((s) => s !== null));
    expect(DOC_SLUGS).not.toContain("overview");
  });

  it("finds a page by slug, and nothing by a slug it does not have", () => {
    expect(docPage("install")?.href).toBe("/docs/install");
    expect(docPage("overview")).toBeUndefined();
    expect(docPage("nope")).toBeUndefined();
  });

  it("walks neighbours without wrapping", () => {
    const first = DOC_ORDER[0];
    const last = DOC_ORDER[DOC_ORDER.length - 1];
    if (!first || !last) throw new Error("the manual has no pages");

    expect(neighbours(first.href).prev).toBeUndefined();
    expect(neighbours(first.href).next).toBe(DOC_ORDER[1]);
    expect(neighbours(last.href).next).toBeUndefined();
    expect(neighbours("/docs/not-a-page")).toEqual({});
  });

  it("chains every page to the next in one unbroken walk", () => {
    let page = DOC_ORDER[0];
    const walked = [];
    while (page) {
      walked.push(page);
      page = neighbours(page.href).next;
    }
    expect(walked).toEqual(DOC_ORDER);
  });
});
