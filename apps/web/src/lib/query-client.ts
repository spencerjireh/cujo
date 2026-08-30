import {
  QueryClient,
  defaultShouldDehydrateQuery,
  environmentManager,
} from "@tanstack/react-query";
import { cache } from "react";

/**
 * Deliberately not a "use client" module: the server pages call this to
 * prefetch, and Next refuses to invoke a client-module function from the
 * server. The client provider imports the same factory, so both sides build
 * their client from one configuration.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 1 },
      dehydrate: {
        // Dehydrating pending queries lets a page start streaming before its
        // prefetch resolves.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per request on the server, and a single shared client in the
 * browser.
 *
 * The server half is wrapped in React `cache` because a request renders in
 * more than one pass — `generateMetadata` and the page itself — and a fresh
 * client per call meant a fresh fetch per pass. Cached, the run page's
 * metadata and its prefetch share one read and one dehydrated entry. In the
 * browser `cache` never memoizes across renders, which is why the singleton
 * below still exists.
 */
export const getQueryClient = cache((): QueryClient => {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
});
