import { generateMetadata, generateStaticParams } from "@/app/docs/[slug]/page";
import { metadata as overviewMetadata } from "@/app/docs/page";
import { DOC_OVERVIEW, DOC_SLUGS, docPage } from "@/lib/docs/nav";
import { describe, expect, it } from "vitest";

/**
 * Metadata is a data-layer unit here, the way the run page's is: it returns
 * plain strings and reads nothing, so it is tested in the node environment
 * rather than by rendering.
 *
 * The assertion that matters is `robots`. The root layout marks the whole board
 * `noindex` and this segment deliberately reverses that, so the field is the one
 * thing standing between "the manual is findable" and "the runs are findable",
 * and it is restated on every page precisely so it can be asserted per page.
 */
describe("docs metadata", () => {
  it("pre-renders exactly the slugs the nav lists", () => {
    expect(generateStaticParams()).toEqual(DOC_SLUGS.map((slug) => ({ slug })));
  });

  it("marks the overview indexable, and names it", () => {
    expect(overviewMetadata.robots).toEqual({ index: true, follow: true });
    expect(overviewMetadata.title).toContain(DOC_OVERVIEW.title);
    expect(overviewMetadata.description).toBe(DOC_OVERVIEW.summary);
  });

  it("marks every other page indexable, with its own title and preview", async () => {
    for (const slug of DOC_SLUGS) {
      const page = docPage(slug);
      if (!page) throw new Error(`no nav entry for ${slug}`);
      const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
      expect(meta.robots).toEqual({ index: true, follow: true });
      expect(meta.title).toBe(`${page.title} — cujo docs`);
      expect(meta.description).toBe(page.summary);
      expect(meta.openGraph).toEqual({ title: meta.title, description: page.summary });
    }
  });

  it("returns nothing for a slug the manual does not have", async () => {
    // Empty rather than invented: an unknown slug is about to 404, and metadata
    // for a page that will not render is metadata for nothing.
    expect(await generateMetadata({ params: Promise.resolve({ slug: "nope" }) })).toEqual({});
    expect(await generateMetadata({ params: Promise.resolve({ slug: "overview" }) })).toEqual({});
  });
});
