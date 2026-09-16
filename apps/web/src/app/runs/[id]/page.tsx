import { HomeMark } from "@/components/brand/HomeMark";
import { RunView } from "@/components/run/RunView";
import { ApiError } from "@/lib/api/client";
import { runKeys } from "@/lib/api/keys";
import type { Plane } from "@/lib/api/owner";
import { fetchOwnerRun } from "@/lib/api/owner-client";
import { runOptions } from "@/lib/api/queries";
import { whoIsReading } from "@/lib/api/session";
import { statusLine } from "@/lib/api/status-line";
import type { Run } from "@/lib/api/types";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, type QueryClient, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The run this page is about, and which plane answered for it.
 *
 * Awaited: this page is nothing without the run, and a 404 from the API has
 * to become a 404 here rather than an empty shell. The public plane first,
 * with no credential, which is what every reader gets. Its 404 is what a
 * private run looks like (decision 34), and for a signed-in owner that is
 * not the whole answer any more (decision 159): the owner plane is asked
 * with the session, and a run it names is rendered on the owner's stream.
 * Anyone else, and any run neither plane names, is a 404 -- the page never
 * says which of the two it was. The client is request-scoped, so the second
 * call in a request is a cache hit.
 */
async function readRun(id: string): Promise<{ queryClient: QueryClient; run: Run; plane: Plane }> {
  const queryClient = getQueryClient();
  const cached = queryClient.getQueryData<Run>(runKeys.detail(id));
  const cachedPlane = queryClient.getQueryData<Plane>(planeKey(id));
  if (cached && cachedPlane) return { queryClient, run: cached, plane: cachedPlane };
  try {
    const run = await queryClient.fetchQuery(runOptions(id));
    queryClient.setQueryData(planeKey(id), "public");
    return { queryClient, run, plane: "public" };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  const reader = await whoIsReading();
  if (!("me" in reader)) notFound();
  try {
    const run = await fetchOwnerRun(id, reader.session);
    queryClient.setQueryData(runKeys.detail(id), run);
    queryClient.setQueryData(planeKey(id), "owner");
    return { queryClient, run, plane: "owner" };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

/** Which plane named the run, kept beside it for the second read in a request. */
const planeKey = (id: string) => [...runKeys.detail(id), "plane"] as const;

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
  const { run } = await readRun(id);

  const heading = `${run.repo} #${run.pr_number}`;
  const title = run.pr_title ? `${heading} — ${run.pr_title}` : heading;
  const critical = run.findings.filter((f) => f.severity === "critical").length;
  const line = statusLine(run.status, run.mode);
  const description = critical > 0 ? `${line} ${critical} critical.` : line;

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
  const { queryClient, plane } = await readRun(id);

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
            <RunView id={id} plane={plane} />
          </div>
        </div>
      </div>
    </HydrationBoundary>
  );
}
