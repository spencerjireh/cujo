// @vitest-environment jsdom

import { SiteFooter } from "@/app/layout";
import { HeroStats } from "@/components/board/HeroReadout";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { ApiError } from "@/lib/api/client";
import { boardMetrics } from "@/lib/board/metrics";
import { runs } from "@/lib/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where a reader can go from any page. The header carries the site's links
 * and who is signed in (decision 175); the footer keeps the manual and the
 * install page as buttons, and the hero legend a quieter manual link.
 */
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const pathname = vi.hoisted(() => ({ current: "/docs" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

// The layout loads its fonts from next/font/google at module scope, which
// only Next can resolve; a test wants the markup, not the typography.
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  JetBrains_Mono: () => ({ variable: "" }),
}));

// The theme control reads a store and a media query; neither is what this
// test is about.
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const fetchMe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/owner-client", () => ({ fetchMe }));

afterEach(() => {
  cleanup();
  fetchMe.mockReset();
  pathname.current = "/docs";
});

function header() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiteHeader />
    </QueryClientProvider>,
  );
}

const link = (name: string) => screen.getAllByRole("link", { name })[0]?.getAttribute("href");

describe("the header (decision 175)", () => {
  it("offers a visitor the board, the manual and sign-in", async () => {
    fetchMe.mockRejectedValue(new ApiError("sign in", 401));
    header();
    expect(link("Board")).toBe("/galaxy");
    expect(link("Manual")).toBe("/docs");
    await waitFor(() => expect(link("Sign in with GitHub")).toBe("/api/auth/login"));
    expect(screen.queryByRole("link", { name: "Activity" })).toBeNull();
    expect(link("cujo, home")).toBe("/");
  });

  it("gives an owner their pages, names them, and sends home to their activity", async () => {
    fetchMe.mockResolvedValue({ login: "octocat", is_owner: true, expires_at: "" });
    header();
    await waitFor(() => expect(link("Activity")).toBe("/activity"));
    expect(link("Repositories")).toBe("/repos");
    expect(link("Settings")).toBe("/settings");
    expect(screen.getByText("@octocat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(link("cujo, home")).toBe("/activity");
  });

  it("marks the page the reader is on", async () => {
    pathname.current = "/repos/octocat/app";
    fetchMe.mockResolvedValue({ login: "octocat", is_owner: true, expires_at: "" });
    header();
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: "Repositories" })[0]?.getAttribute("aria-current"),
      ).toBe("page"),
    );
    expect(
      screen.getAllByRole("link", { name: "Activity" })[0]?.getAttribute("aria-current"),
    ).toBeNull();
  });

  it("offers a signed-in non-owner only sign-out", async () => {
    fetchMe.mockResolvedValue({ login: "hubot", is_owner: false, expires_at: "" });
    header();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Repositories" })).toBeNull();
  });

  it("offers no sign-in on an instance without one, or when the plane does not answer", async () => {
    for (const status of [404, 502]) {
      fetchMe.mockRejectedValue(new ApiError("no", status));
      const { unmount } = header();
      await waitFor(() => expect(fetchMe).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("link", { name: "Sign in with GitHub" })).toBeNull();
      expect(link("Board")).toBe("/galaxy");
      unmount();
      fetchMe.mockReset();
    }
  });
});

describe("the footer and the hero legend", () => {
  it("puts the manual and the install page on the footer", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "Manual" }).getAttribute("href")).toBe("/docs");
    expect(screen.getByRole("link", { name: "Install the App" }).getAttribute("href")).toBe(
      "/docs/install",
    );
  });

  it("puts a manual link on the hero legend", () => {
    render(<HeroStats metrics={boardMetrics(runs)} interactive />);
    expect(screen.getByRole("link", { name: "Manual" }).getAttribute("href")).toBe("/docs");
  });
});
