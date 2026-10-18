// @vitest-environment jsdom

import { RunVerdict } from "@/components/run/RunVerdict";
import { run } from "@/lib/fixtures";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The head of the run page (decision 175): the verdict, the critical findings
 * by name and place, and what the reader does next.
 */
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("RunVerdict", () => {
  it("names a block by its critical findings and says how to lift it", () => {
    render(<RunVerdict run={run()} />);
    expect(screen.getByText("Blocked by 4 critical findings")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Critical findings" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    // A hard-rule finding has no file, so its place is its evidence.
    expect(
      within(list).getByText("orders.test.ts:41, orders.test.ts:58, orders.test.ts:77"),
    ).toBeTruthy();
    expect(screen.getByText("/cujo dismiss").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "How blocking works" }).getAttribute("href")).toBe(
      "/docs/blocking",
    );
  });

  it("folds the other findings, with a path and line where the finding has one", () => {
    render(<RunVerdict run={run()} />);
    expect(screen.queryByText("app/pricing.py:28")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 other findings/ }));
    expect(screen.getByText("app/pricing.py:28")).toBeTruthy();
  });

  it("lists nothing while the run is still going", () => {
    render(<RunVerdict run={run({ status: "running" })} />);
    expect(screen.getByText("Review running")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Critical findings" })).toBeNull();
  });

  it("tells a clean run there is nothing to do", () => {
    render(<RunVerdict run={run({ status: "clean", findings: [] })} />);
    expect(screen.getByText("No blocking findings")).toBeTruthy();
    expect(screen.getByText(/Nothing to do/)).toBeTruthy();
  });
});
