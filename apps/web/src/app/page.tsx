import { RunsView } from "@/components/runs/RunsView";
import { serverMode } from "@/lib/api/mode";
import { runsListOptions } from "@/lib/api/queries";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

export const dynamic = "force-dynamic";

export default async function Page() {
  const queryClient = getQueryClient();
  const mode = await serverMode();

  // Awaited. Leaving it pending and dehydrating the pending query streams the
  // shell sooner, but then the server renders the loading state while the
  // client hydrates with data already in the cache, and React reports the
  // difference as a hydration error. `GET /runs` is one small request, so the
  // wait costs less than a Suspense boundary would.
  //
  // A failure here is not fatal: RunsView refetches in the browser and shows
  // its own error state, which also covers the API being briefly unreachable.
  await queryClient.prefetchQuery(runsListOptions(mode));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RunsView />
    </HydrationBoundary>
  );
}
