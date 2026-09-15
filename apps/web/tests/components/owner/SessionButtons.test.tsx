// @vitest-environment jsdom

import { SessionButtons } from "@/components/owner/SessionButtons";
import { ApiError } from "@/lib/api/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The footer's sign-in control has four answers and draws three things
 * (decision 156): signed out is a button, signed in is a link and a sign-out,
 * and both "no sign-in configured" and "the plane did not answer" are
 * nothing at all.
 */
const fetchMe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/owner-client", () => ({ fetchMe }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  fetchMe.mockReset();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionButtons className="btn" />
    </QueryClientProvider>,
  );
}

describe("SessionButtons", () => {
  it("offers sign-in when the plane says nobody is signed in", async () => {
    fetchMe.mockRejectedValue(new ApiError("sign in", 401));
    mount();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Sign in with GitHub" })).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe(
      "/api/auth/login",
    );
  });

  it("names the repositories and offers sign-out to an owner", async () => {
    fetchMe.mockResolvedValue({ login: "octocat", is_owner: true, expires_at: "" });
    mount();
    await waitFor(() => expect(screen.getByRole("link", { name: "Repositories" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Sign out" }).getAttribute("title")).toBe(
      "Signed in as octocat",
    );
  });

  it("offers only sign-out to a signed-in non-owner", async () => {
    fetchMe.mockResolvedValue({ login: "hubot", is_owner: false, expires_at: "" });
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Repositories" })).toBeNull();
  });

  it("draws nothing on an instance with no sign-in, or when the plane does not answer", async () => {
    fetchMe.mockRejectedValue(new ApiError("not found", 404));
    const { container, unmount } = mount();
    await waitFor(() => expect(fetchMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    unmount();
    fetchMe.mockReset();
    fetchMe.mockRejectedValue(new ApiError("cujo is unreachable", 502));
    const second = mount();
    await waitFor(() => expect(fetchMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(second.container.textContent).toBe("");
  });
});
