import { HomeMark } from "@/components/brand/HomeMark";
import { RepositoryView } from "@/components/owner/RepositoryView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchRepositorySettings } from "@/lib/api/owner-client";
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
  const queryClient = getQueryClient();
  if ("me" in reader) {
    // The session is not seeded here, on purpose. The footer's sign-in state
    // reads `me` in the browser, and this page is async: the server streams
    // the footer before the page resolves, with an empty cache, while the
    // browser would hydrate with a seeded one. Seeding it made every owner
    // page a hydration mismatch.
    // `prefetchQuery` never throws: a repository the registry has not heard
    // of is a 404 the view shows in place, with the list one link away, and
    // a plane that did not answer is the view's error state. The list page
    // prefetches the same way.
    await queryClient.prefetchQuery({
      queryKey: ownerKeys.settings(repo),
      queryFn: () => fetchRepositorySettings(repo, reader.session),
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="relative">
        <HomeMark />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="pt-10">
            {"me" in reader ? <RepositoryView repo={repo} /> : <SignedOut reason={reader.reason} />}
          </div>
        </div>
      </div>
    </HydrationBoundary>
  );
}
