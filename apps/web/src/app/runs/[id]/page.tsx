import { HomeMark } from "@/components/brand/HomeMark";
import { RunView } from "@/components/run/RunView";
import { ApiError } from "@/lib/api/client";
import { runOptions } from "@/lib/api/queries";
import { STATUS_LINE } from "@/lib/api/status-line";
import type { Run } from "@/lib/api/types";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * What a run link says about itself, wherever it is pasted (decision 86).
 *
 * Built only from fields the anonymous caller can already read from this very
 * URL — the title, the status and the findings the detail route serves in full
 * — which is decision 65's argument, applied to the preview: it discloses
 * nothing new. Without it, Discord and Slack unfurl every run link as the
 * site's front page, two lines that name no run at all.
 *
 * A private run has no page (decision 57), so it 404s here as everywhere else
 * and inherits the site's default metadata off the 404 — the correct answer
 * for a run the reader cannot see.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const queryClient = getQueryClient();
  let run: Run;
  try {
    run = await queryClient.fetchQuery(runOptions(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const heading = `${run.repo} #${run.pr_number}`;
  const title = run.pr_title ? `${heading} — ${run.pr_title}` : heading;
  const critical = run.findings.filter((f) => f.severity === "critical").length;
  const description =
    critical > 0 ? `${STATUS_LINE[run.status]} ${critical} critical.` : STATUS_LINE[run.status];

  return {
    title,
    description,
    // Open Graph is about previews, not discoverability, so the root layout's
    // rule is restated rather than inherited by accident: the board is shared
    // by link and not found by search.
    robots: { index: false, follow: false },
    openGraph: { title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queryClient = getQueryClient();

  // Awaited, unlike the list: this page is nothing without the run, and a 404
  // from the API has to become a 404 here rather than an empty shell. That same
  // 404 is what a private run looks like, so it needs no handling of its own
  // (decision 34) — and since decision 57 there is no other page for a private
  // run to be on, so 404 is the whole answer. The read is the one
  // `generateMetadata` already made: the client is request-scoped, so this is
  // a cache hit that exists to keep the 404 and the throw on this page.
  try {
    await queryClient.fetchQuery(runOptions(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Two boxes, and the mark is on the outer one. The column the layout
          used to impose is the inner box — it stayed with the pages that want
          it when the board took the full window — but `HomeMark` positions
          itself against its nearest positioned ancestor, and against a centred
          `max-w-5xl` that is half a gutter in from the window on a wide screen.
          The board's mark sits in the window's own corner, because there it is
          inside the full-bleed chamber. One mark in two places is two marks, so
          the positioned box here is the full width and the column sits inside
          it. It still carries the page's own text colour: the mark follows the
          reader's theme here and never on the board, which is why it is placed
          per page rather than by the layout. */}
      <div className="relative">
        <HomeMark />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="pt-10">
            <RunView id={id} />
          </div>
        </div>
      </div>
    </HydrationBoundary>
  );
}
