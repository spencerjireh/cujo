"use client";

import type { Mode } from "@/lib/api/mode";
import { getQueryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, createContext, useContext, useMemo } from "react";

export interface PlaneContext {
  mode: Mode;
  /** Where a public visitor goes to act. Empty when not configured. */
  adminBaseUrl: string;
}

/**
 * Operator by default, matching the polarity in `lib/api/mode.ts`: a component
 * rendered outside this provider asks the gated API and is answered 401, rather
 * than quietly rendering as if it were public.
 */
const Plane = createContext<PlaneContext>({ mode: "operator", adminBaseUrl: "" });

export function usePlane(): PlaneContext {
  return useContext(Plane);
}

/**
 * The plane on its own, without the app's QueryClient. Storybook needs the two
 * separately: it seeds its own client per story but still has to say which
 * plane a story is showing.
 */
export function PlaneProvider({
  children,
  mode,
  adminBaseUrl = "",
}: {
  children: ReactNode;
  mode: Mode;
  adminBaseUrl?: string;
}) {
  const plane = useMemo(() => ({ mode, adminBaseUrl }), [mode, adminBaseUrl]);
  return <Plane.Provider value={plane}>{children}</Plane.Provider>;
}

export function Providers({
  children,
  mode,
  adminBaseUrl,
}: {
  children: ReactNode;
  mode: Mode;
  adminBaseUrl: string;
}) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <PlaneProvider mode={mode} adminBaseUrl={adminBaseUrl}>
        {children}
      </PlaneProvider>
    </QueryClientProvider>
  );
}
