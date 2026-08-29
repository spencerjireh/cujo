import { RunView } from "@/components/run/RunView";
import { ApiError } from "@/lib/api/client";
import { runOptions } from "@/lib/api/queries";
import { getQueryClient } from "@/lib/query-client";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queryClient = getQueryClient();

  // Awaited, unlike the list: this page is nothing without the run, and a 404
  // from the API has to become a 404 here rather than an empty shell. That same
  // 404 is what a private run looks like, so it needs no handling of its own
  // (decision 34) — and since decision 52 there is no other page for a private
  // run to be on, so 404 is the whole answer.
  try {
    await queryClient.fetchQuery(runOptions(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RunView id={id} />
    </HydrationBoundary>
  );
}
