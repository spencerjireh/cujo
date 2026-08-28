import {
  QueryClient,
  defaultShouldDehydrateQuery,
  environmentManager,
} from "@tanstack/react-query";

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
 * A fresh client per request on the server, so one request's cache never leaks
 * into another, and a single shared client in the browser.
 */
export function getQueryClient(): QueryClient {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
