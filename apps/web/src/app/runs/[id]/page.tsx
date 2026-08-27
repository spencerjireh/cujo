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
  // from the API has to become a 404 here rather than an empty shell.
  try {
    await queryClient.fetchQuery(runOptions(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    // 401 means the Access assertion never reached the API. Behind Cloudflare
    // that cannot normally happen, so say what is wrong rather than showing a
    // stack: the alternative is an unexplained 500 on the approval page.
    if (error instanceof ApiError && error.status === 401) return <NotAuthorized />;
    throw error;
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RunView id={id} />
    </HydrationBoundary>
  );
}

function NotAuthorized() {
  return (
    <div>
      <h1 className="mb-2 text-2xl">Not signed in</h1>
      <p className="max-w-[60ch] text-sm text-fg-muted">
        The Cujo API refused this request because it carried no Cloudflare Access assertion. Sign in
        through Access and reload. If you are running locally, start the stack with
        <code className="mx-1 rounded-sm bg-bg-raised px-1.5 py-0.5">CUJO_DEV_NO_ACCESS=1</code>
        set on the cujo service.
      </p>
    </div>
  );
}
