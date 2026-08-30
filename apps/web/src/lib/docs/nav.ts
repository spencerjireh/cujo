/**
 * The order of the manual, in one place.
 *
 * Grouping, titles and sequence live here and nowhere else, so the sidebar, the
 * prev/next pair, `generateStaticParams` and the metadata all read the same
 * list. A page is added by adding a line here and a component to
 * `components/docs/registry.ts`; a line here with no component is a test
 * failure rather than a 404 nobody notices.
 *
 * The groups are tasks and not topics. A reader arrives either wanting to point
 * Cujo at a repository, wanting to understand what a verdict means, wanting to
 * use it day to day, or wanting to run their own — and those four questions are
 * asked in that order.
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
  summary:
    "A reviewer that runs the pull request before it says anything about it, and what that does and does not buy you.",
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
        summary:
          "Put the GitHub App on a repository, open a pull request, and read what comes back.",
      },
      {
        slug: "configure",
        href: "/docs/configure",
        title: "Configure a repo",
        summary:
          "What .cujo.yml accepts, which branch each key is read from, and why that is not the same branch.",
      },
    ],
  },
  {
    label: "Concepts",
    pages: [
      {
        slug: "how-it-works",
        href: "/docs/how-it-works",
        title: "How a review runs",
        summary: "Webhook to sandbox to review, in the order it happens.",
      },
      {
        slug: "checks",
        href: "/docs/checks",
        title: "The four checks",
        summary:
          "Tests, probes, a smoke boot and dependency detonation, and the four sensors watching all of them.",
      },
      {
        slug: "findings",
        href: "/docs/findings",
        title: "Findings and severity",
        summary:
          "What critical means, which rules the agent cannot argue with, and why a false reads as not observed.",
      },
      {
        slug: "the-gate",
        href: "/docs/the-gate",
        title: "The human gate",
        summary:
          "Most reviews post unattended. One kind waits for a person, and this is which kind and who may answer.",
      },
      {
        slug: "sandbox",
        href: "/docs/sandbox",
        title: "The sandbox boundary",
        summary:
          "Running a pull request means running a stranger's code. Where that happens, and what is allowed across the line.",
      },
    ],
  },
  {
    label: "Using it",
    pages: [
      {
        slug: "discord",
        href: "/docs/discord",
        title: "Discord notifications",
        summary:
          "Optional, bound by two halves that different people prove, and it decides nothing.",
      },
      {
        slug: "conversation",
        href: "/docs/conversation",
        title: "Asking questions",
        summary:
          "@cujo-guard answers by running the pull request again, not by rewording the review.",
      },
      {
        slug: "board",
        href: "/docs/board",
        title: "Reading the board",
        summary: "What this site shows, what it deliberately does not, and who can see it.",
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
        summary:
          "The services, the environment, your own GitHub App, and the two settings that fail confusingly.",
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
