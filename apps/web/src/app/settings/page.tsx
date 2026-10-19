import { SignedOut } from "@/components/owner/SignedOut";
import { SettingsView } from "@/components/owner/settings/SettingsView";
import { fetchInstanceSettings } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { whoIsReading } from "@/lib/api/session";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** An owner's page: never indexed (decisions 157, 175). */
export const metadata: Metadata = {
  title: "Settings — cujo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const reader = await whoIsReading();
  if (!("me" in reader)) return <SignedOut title="Settings" reason={reader.reason} />;
  const queryClient = getQueryClient();
  // The session is not seeded (see /repos). The App's state and the health
  // are read in the browser, since one asks GitHub and the other is asked
  // again every few seconds.
  await queryClient.prefetchQuery({
    queryKey: ownerKeys.instance(),
    queryFn: () => fetchInstanceSettings(reader.session),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsView />
    </HydrationBoundary>
  );
}
