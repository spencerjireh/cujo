import { RepositoriesView } from "@/components/owner/RepositoriesView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchOwnerRuns, fetchRepositories } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { whoIsReading } from "@/lib/api/session";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** An owner's page, and nobody else's: never indexed (decision 156). */
export const metadata: Metadata = {
  title: "Repositories — cujo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const reader = await whoIsReading();
  if (!("me" in reader)) return <SignedOut title="Repositories" reason={reader.reason} />;
  const queryClient = getQueryClient();
  // The session is not seeded here, on purpose. The header's sign-in state
  // reads `me` in the browser, and this page is async: the server streams
  // the header before the page resolves, with an empty cache, while the
  // browser would hydrate with a seeded one. Seeding it made every owner
  // page a hydration mismatch.
  // `prefetchQuery` never throws; a plane that did not answer is the view's
  // error state, not a failed render.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ownerKeys.repositories(),
      queryFn: () => fetchRepositories(reader.session),
    }),
    queryClient.prefetchQuery({
      queryKey: ownerKeys.runs(),
      queryFn: () => fetchOwnerRuns(reader.session),
    }),
  ]);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RepositoriesView />
    </HydrationBoundary>
  );
}
