import { HomeMark } from "@/components/brand/HomeMark";
import { InstanceView } from "@/components/owner/InstanceView";
import { SignedOut } from "@/components/owner/SignedOut";
import { fetchInstanceSettings } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { whoIsReading } from "@/lib/api/session";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** An owner's page: never indexed (decision 157). */
export const metadata: Metadata = {
  title: "Instance — cujo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const reader = await whoIsReading();
  const queryClient = getQueryClient();
  if ("me" in reader) {
    // The session is not seeded here, on purpose. The footer's sign-in state
    // reads `me` in the browser, and this page is async: the server streams
    // the footer before the page resolves, with an empty cache, while the
    // browser would hydrate with a seeded one. Seeding it made every owner
    // page a hydration mismatch.
    // `prefetchQuery` never throws; a plane that did not answer is the view's
    // error state. The App's state and the health are read in the browser,
    // since one asks GitHub and the other is asked again every few seconds.
    await queryClient.prefetchQuery({
      queryKey: ownerKeys.instance(),
      queryFn: () => fetchInstanceSettings(reader.session),
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="relative">
        <HomeMark />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="pt-10">
            {"me" in reader ? <InstanceView /> : <SignedOut reason={reader.reason} />}
          </div>
        </div>
      </div>
    </HydrationBoundary>
  );
}
