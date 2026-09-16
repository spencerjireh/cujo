// @vitest-environment jsdom

import Page, { metadata } from "@/app/page";
import { INSTALL_URL } from "@/lib/install-url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The front door (decision 160): indexed, and its first two links decided by
 * who is reading. The page reads the request's cookie through `next/headers`,
 * which has no request here, so the reader is stubbed.
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

  it("sends an owner to their pages, and keeps the manual", async () => {
    vi.mocked(whoIsReading).mockResolvedValueOnce({
      me: { login: "octocat", is_owner: true },
      session: "a".repeat(64),
    });
    render(await Page());
    expect(screen.getByRole("link", { name: "Your repositories" }).getAttribute("href")).toBe(
      "/repos",
    );
    expect(screen.getByRole("link", { name: "Instance" }).getAttribute("href")).toBe("/instance");
    expect(screen.getByRole("link", { name: "Read the manual" }).getAttribute("href")).toBe(
      "/docs",
    );
    expect(screen.queryByRole("link", { name: "Install the App" })).toBeNull();
  });
});
