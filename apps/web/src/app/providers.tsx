"use client";

import { getQueryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * There used to be a plane context here, because one container answered two
 * hostnames and a component had to know which one it was rendering for
 * (decision 34). Decision 52 deleted the operator plane, so every render is the
 * anonymous board and the only thing left to provide is the QueryClient.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
