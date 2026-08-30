import { DocsFooterNav } from "@/components/docs/DocsFooterNav";
import { DocTitle } from "@/components/docs/Prose";
import { DOC_COMPONENTS } from "@/components/docs/registry";
import { DOC_SLUGS, docPage } from "@/lib/docs/nav";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * Every topic but the overview.
 *
 * Static, unlike the board and the run page: those are `force-dynamic` because
 * they read the run API on every request, and these read nothing at all.
 */
export function generateStaticParams(): { slug: string }[] {
  return DOC_SLUGS.map((slug) => ({ slug }));
}

/**
 * `robots` is restated rather than inherited from the layout, for the reason the
 * run page restates its own: this is the field that decides whether a page is
 * indexed, and a guarantee stated on the page is one a test can hold.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = docPage(slug);
  if (!page) return {};
  const title = `${page.title} — cujo docs`;
  return {
    title,
    description: page.summary,
    robots: { index: true, follow: true },
    openGraph: { title, description: page.summary },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docPage(slug);
  const Body = DOC_COMPONENTS[slug];
  // Both, and not one: a slug listed in the nav with no component, or the other
  // way round, is a bug the registry test catches — but it must not render half
  // a page in the meantime.
  if (!page || !Body) notFound();

  return (
    <article>
      <DocTitle title={page.title} summary={page.summary} />
      <Body />
      <DocsFooterNav href={page.href} />
    </article>
  );
}
