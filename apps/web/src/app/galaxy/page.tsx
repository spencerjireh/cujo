import { RunsView } from "@/components/runs/RunsView";
import { runsListOptions } from "@/lib/api/queries";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * The board: every public run, drawn as a galaxy (decisions 80 to 95), at its
 * own address since the front page became a landing (decision 160). Not
 * indexed, as it never was: a run quotes somebody else's code.
 */
export const metadata: Metadata = {
  title: "The board — cujo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const queryClient = getQueryClient();

  // Awaited. Leaving it pending and dehydrating the pending query streams the
  // shell sooner, but then the server renders the loading state while the
  // client hydrates with data already in the cache, and React reports the
  // difference as a hydration error. `GET /runs` is one small request, so the
  // wait costs less than a Suspense boundary would.
  //
  // A failure here is not fatal: RunsView refetches in the browser and shows
  // its own error state, which also covers the API being briefly unreachable.
  await queryClient.prefetchQuery(runsListOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RunsView />
    </HydrationBoundary>
  );
}
