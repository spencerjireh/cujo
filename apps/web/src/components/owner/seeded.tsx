import type {
  BotState,
  Health,
  InstanceSettingsView,
  OwnedRepository,
} from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import type { RunSummary } from "@/lib/api/types";
import { ownerRuns } from "@/lib/fixtures";
import { bot, catalog, health, instanceView, repositories } from "@/lib/owner/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

/**
 * A story decorator with the owner plane already answered (decision 175):
 * everything an owner page reads, seeded and never refetched, with any part
 * overridden. `null` for `bot` is GitHub not answering.
 */
export function seeded(
  over: {
    settings?: InstanceSettingsView;
    bot?: BotState | null;
    health?: Health;
    repositories?: OwnedRepository[];
    runs?: RunSummary[];
    extra?: (client: QueryClient) => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, refetchInterval: false },
    },
  });
  client.setQueryData(ownerKeys.instance(), over.settings ?? instanceView);
  client.setQueryData(ownerKeys.providerModels("anthropic"), catalog);
  client.setQueryData(ownerKeys.health(), over.health ?? health);
  client.setQueryData(ownerKeys.repositories(), over.repositories ?? repositories);
  client.setQueryData(ownerKeys.runs(), { runs: over.runs ?? ownerRuns });
  client.setQueryData(ownerKeys.me(), { login: "spencerjireh", is_owner: true, expires_at: "" });
  if (over.bot !== null) client.setQueryData(ownerKeys.bot(), over.bot ?? bot);
  else {
    // A query that already failed: GitHub did not answer.
    void client.prefetchQuery({
      queryKey: ownerKeys.bot(),
      queryFn: () => Promise.reject(new Error("GitHub did not answer")),
    });
  }
  over.extra?.(client);
  return function Decorated(Story: () => ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}
