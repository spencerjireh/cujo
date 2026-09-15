import { HomeMark } from "@/components/brand/HomeMark";
import { RepositoriesView } from "@/components/owner/RepositoriesView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchRepositories } from "@/lib/api/owner-client";
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
  const queryClient = getQueryClient();
  if ("me" in reader) {
    queryClient.setQueryData(ownerKeys.me(), { ...reader.me, expires_at: "" });
    // `prefetchQuery` never throws; a plane that did not answer is the
    // view's error state, not a failed render.
    await queryClient.prefetchQuery({
      queryKey: ownerKeys.repositories(),
      queryFn: () => fetchRepositories(reader.session),
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="relative">
        <HomeMark />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="pt-10">
            {"me" in reader ? <RepositoriesView /> : <SignedOut reason={reader.reason} />}
          </div>
        </div>
      </div>
    </HydrationBoundary>
  );
}
