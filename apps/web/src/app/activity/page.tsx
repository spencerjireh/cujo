import { ActivityView } from "@/components/owner/ActivityView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchInstanceSettings, fetchOwnerRuns, fetchRepositories } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { whoIsReading } from "@/lib/api/session";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** An owner's home (decision 175): never indexed. */
export const metadata: Metadata = {
  title: "Activity — cujo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const reader = await whoIsReading();
  if (!("me" in reader)) return <SignedOut title="Activity" reason={reader.reason} />;
  const queryClient = getQueryClient();
  // The session is not seeded (see /repos). `prefetchQuery` never throws; a
  // plane that did not answer is the view's error state. The App's state and
  // the health are read in the browser: one asks GitHub, and the other is
  // asked again every few seconds.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ownerKeys.runs(),
      queryFn: () => fetchOwnerRuns(reader.session),
    }),
    queryClient.prefetchQuery({
      queryKey: ownerKeys.repositories(),
      queryFn: () => fetchRepositories(reader.session),
    }),
    queryClient.prefetchQuery({
      queryKey: ownerKeys.instance(),
      queryFn: () => fetchInstanceSettings(reader.session),
    }),
  ]);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ActivityView />
    </HydrationBoundary>
  );
}
