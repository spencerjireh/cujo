import { DocsFooterNav } from "@/components/docs/DocsFooterNav";
import { DocTitle } from "@/components/docs/Prose";
import { Overview } from "@/components/docs/pages/Overview";
import { DOC_OVERVIEW } from "@/lib/docs/nav";
import type { Metadata } from "next";

/**
 * `/docs` is the overview itself rather than an index of links.
 *
 * The sidebar is already the index, and a landing page whose whole content is a
 * second copy of it costs the reader a click to learn nothing. The overview has
 * no slug for the same reason: one page reachable at two URLs is a page that can
 * be linked two ways and indexed twice.
 */
const PAGE = DOC_OVERVIEW;

export const metadata: Metadata = {
  title: `${PAGE.title} — cujo docs`,
  description: PAGE.summary,
  robots: { index: true, follow: true },
  openGraph: { title: `${PAGE.title} — cujo docs`, description: PAGE.summary },
};

export default function Page() {
  return (
    <article>
      <DocTitle title={PAGE.title} summary={PAGE.summary} />
      <Overview />
      <DocsFooterNav href={PAGE.href} />
    </article>
  );
}
