import { RepositoryView } from "@/components/owner/RepositoryView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchOwnerRuns, fetchRepositorySettings } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { whoIsReading } from "@/lib/api/session";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; name: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `${owner}/${name} — cujo`, robots: { index: false, follow: false } };
}

export default async function Page({ params }: Params) {
  const { owner, name } = await params;
  const repo = `${owner}/${name}`;
  const reader = await whoIsReading();
  if (!("me" in reader)) return <SignedOut title={repo} reason={reader.reason} />;
  const queryClient = getQueryClient();
  // The session is not seeded (see /repos). `prefetchQuery` never throws: a
  // repository the registry has not heard of is a 404 the view shows in
  // place, and a plane that did not answer is the view's error state.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ownerKeys.settings(repo),
      queryFn: () => fetchRepositorySettings(repo, reader.session),
    }),
    queryClient.prefetchQuery({
      queryKey: ownerKeys.runs(),
      queryFn: () => fetchOwnerRuns(reader.session),
    }),
  ]);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RepositoryView repo={repo} />
    </HydrationBoundary>
  );
}
