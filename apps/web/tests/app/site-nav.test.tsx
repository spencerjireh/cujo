// @vitest-environment jsdom

import { SiteFooter } from "@/app/layout";
import { HeroStats } from "@/components/board/HeroReadout";
import { boardMetrics } from "@/lib/board/metrics";
import { runs } from "@/lib/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where the manual can be reached from. The site has no bar, so the two
 * places are the footer (as buttons, with the install page beside the manual)
 * and the hero legend. A link that points anywhere else, or is missing, sends
 * a reader who has decided to try Cujo to a dead end.
 */
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The layout loads its fonts from next/font/google at module scope, which
// only Next can resolve; a test wants the markup, not the typography.
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  JetBrains_Mono: () => ({ variable: "" }),
}));

// The theme control reads a store and a media query; neither is what this
// test is about.
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

afterEach(cleanup);

describe("site navigation to the manual", () => {
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
