import { DOC_COMPONENTS } from "@/components/docs/registry";
import { DOC_SLUGS } from "@/lib/docs/nav";
import { describe, expect, it } from "vitest";

/**
 * The guard between the sidebar and a 404.
 *
 * `nav.ts` decides what is listed and `registry.ts` decides what renders, and
 * nothing at runtime makes the two agree — a page added to one and not the
 * other is a link in the sidebar that answers 404, which is exactly the kind of
 * thing nobody notices until a reader reports it.
 */
describe("doc registry", () => {
  it("holds a component for every slug the nav lists, and no others", () => {
    expect(Object.keys(DOC_COMPONENTS).sort()).toEqual([...DOC_SLUGS].sort());
  });

  it("maps each slug to something renderable", () => {
    for (const slug of DOC_SLUGS) {
      expect(typeof DOC_COMPONENTS[slug]).toBe("function");
    }
  });
});
