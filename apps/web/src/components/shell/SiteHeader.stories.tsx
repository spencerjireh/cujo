import { ApiError } from "@/lib/api/client";
import { ownerKeys } from "@/lib/api/owner-keys";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SiteHeader } from "./SiteHeader";

/** A header with `/me` already answered, or already refused with `status`. */
function session(me: { login: string; is_owner: boolean } | { status: number }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if ("login" in me) client.setQueryData(ownerKeys.me(), { ...me, expires_at: "" });
  else {
    void client.prefetchQuery({
      queryKey: ownerKeys.me(),
      queryFn: () => Promise.reject(new ApiError("no session", me.status)),
    });
  }
  return function Decorated(Story: () => ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof SiteHeader> = {
  title: "Shell/SiteHeader",
  component: SiteHeader,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof SiteHeader>;

/** Signed out: the board, the manual, and sign-in. */
export const Visitor: Story = {
  decorators: [session({ status: 401 })],
  parameters: { nextjs: { navigation: { pathname: "/docs" } } },
};

/** An owner on one of their repositories. */
export const Owner: Story = {
  decorators: [session({ login: "spencerjireh", is_owner: true })],
  parameters: { nextjs: { navigation: { pathname: "/repos/spencerjireh/cujo" } } },
};

/** On the board, floating over the chamber. */
export const OverTheChamber: Story = {
  decorators: [
    session({ login: "spencerjireh", is_owner: true }),
    (Story) => (
      <div className="relative h-48 bg-[var(--chamber)]">
        <Story />
      </div>
    ),
  ],
  parameters: { nextjs: { navigation: { pathname: "/galaxy" } } },
};
