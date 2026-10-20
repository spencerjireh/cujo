/**
 * The order of the manual, in one place.
 *
 * Grouping, titles and sequence live here and nowhere else, so the sidebar, the
 * prev/next pair, `generateStaticParams` and the metadata all read the same
 * list. A page is added by adding a line here and a component to
 * `components/docs/registry.ts`; a line here with no component is a test
 * failure rather than a 404 nobody notices.
 *
 * Three groups, in the order a reader needs them: start using Cujo, use it
 * day to day, or run your own.
 */

/**
 * `slug` is null for the overview alone, which is served at `/docs` itself
 * rather than at `/docs/overview`. Two URLs for one page is a page that can be
 * linked two ways and indexed twice, and the overview is the one page a link
 * to "the docs" should land on.
 */
export type DocPage = {
  slug: string | null;
  href: string;
  title: string;
  /** The sentence under the title, and the page's meta description. */
  summary: string;
};

export type DocGroup = {
  label: string;
  pages: readonly DocPage[];
};

/**
 * The overview, named rather than reached by index.
 *
 * `/docs/page.tsx` needs this exact entry for its own title and metadata, and
 * `DOC_GROUPS[0].pages[0]` is an index the compiler cannot prove is inhabited.
 * Naming it also states which page is the front of the manual, instead of
 * leaving that to list order.
 */
export const DOC_OVERVIEW: DocPage = {
  slug: null,
  href: "/docs",
  title: "What Cujo is",
  summary: "A pull request reviewer that runs the code before it writes the review.",
};

export const DOC_GROUPS: readonly DocGroup[] = [
  {
    label: "Start",
    pages: [
      DOC_OVERVIEW,
      {
        slug: "install",
        href: "/docs/install",
        title: "Install it",
        summary: "Install the GitHub App, require its check, and open a pull request.",
      },
      {
        slug: "configure",
        href: "/docs/configure",
        title: "Configure a repo",
        summary: "The optional .cujo.yml file, and how to send reviews to Discord.",
      },
    ],
  },
  {
    label: "Using it",
    pages: [
      {
        slug: "reviews",
        href: "/docs/reviews",
        title: "Reading a review",
        summary: "What Cujo runs, what each severity means, and how to ask it questions.",
      },
      {
        slug: "blocking",
        href: "/docs/blocking",
        title: "Blocking and unblocking",
        summary: "When a review blocks the merge, and how a maintainer lifts the block.",
      },
    ],
  },
  {
    label: "Run your own",
    pages: [
      {
        slug: "self-host",
        href: "/docs/self-host",
        title: "Self-hosting",
        summary: "Deploy your own instance with your own GitHub App and model provider.",
      },
    ],
  },
];

/** Every page in reading order, which is what prev/next walks. */
export const DOC_ORDER: readonly DocPage[] = DOC_GROUPS.flatMap((group) => group.pages);

/** Every slug that `/docs/[slug]` serves. The overview is not one of them. */
export const DOC_SLUGS: readonly string[] = DOC_ORDER.map((page) => page.slug).filter(
  (slug): slug is string => slug !== null,
);

export function docPage(slug: string): DocPage | undefined {
  return DOC_ORDER.find((page) => page.slug === slug);
}

/**
 * The pages either side of one, by href.
 *
 * No wraparound. The last page's next is undefined, because a manual that loops
 * back to its first page from its last one is telling the reader they missed
 * something.
 */
export function neighbours(href: string): { prev?: DocPage; next?: DocPage } {
  const index = DOC_ORDER.findIndex((page) => page.href === href);
  if (index === -1) return {};
  return { prev: DOC_ORDER[index - 1], next: DOC_ORDER[index + 1] };
}
