// @vitest-environment jsdom

import Page, { metadata } from "@/app/page";
import { INSTALL_URL } from "@/lib/install-url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The front door (decision 160): indexed, and only for a visitor; an owner
 * is sent to their activity (decision 175). The page reads the request's
 * cookie through `next/headers`, which has no request here, so the reader is
 * stubbed.
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/session", () => ({
  whoIsReading: vi.fn(async () => ({ reason: "anonymous" })),
}));
import { whoIsReading } from "@/lib/api/session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
import { redirect } from "next/navigation";

afterEach(cleanup);

describe("the landing", () => {
  it("is indexed, unlike the board", () => {
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("sends a visitor to the App and the manual", async () => {
    render(await Page());
    expect(screen.getByRole("link", { name: "Install the App" }).getAttribute("href")).toBe(
      INSTALL_URL,
    );
    expect(screen.getByRole("link", { name: "Read the manual" }).getAttribute("href")).toBe(
      "/docs",
    );
    expect(screen.queryByRole("link", { name: "Your repositories" })).toBeNull();
    // The board is one link away, never on the page itself.
    expect(screen.getByRole("link", { name: "the board" }).getAttribute("href")).toBe("/galaxy");
  });

  it("sends an owner to their activity", async () => {
    vi.mocked(whoIsReading).mockResolvedValueOnce({
      me: { login: "octocat", is_owner: true },
      session: "a".repeat(64),
    });
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/activity");
  });

  it("shows a signed-in non-owner the front door", async () => {
    vi.mocked(whoIsReading).mockResolvedValueOnce({
      me: { login: "hubot", is_owner: false },
      session: "a".repeat(64),
    });
    render(await Page());
    expect(screen.getByRole("link", { name: "Install the App" })).toBeTruthy();
  });

  it("says why a sign-in did not finish, and offers it again", async () => {
    render(await Page({ searchParams: Promise.resolve({ signin: "expired" }) }));
    expect(screen.getByText("Sign-in took too long. Sign in again.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe(
      "/api/auth/login",
    );
  });

  it("ignores a reason it does not know", async () => {
    render(await Page({ searchParams: Promise.resolve({ signin: "<script>" }) }));
    expect(screen.queryByRole("link", { name: "Sign in with GitHub" })).toBeNull();
  });
});
