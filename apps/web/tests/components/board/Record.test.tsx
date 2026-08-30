// @vitest-environment jsdom

import { Record } from "@/components/board/Record";
import type { RunSummary } from "@/lib/api/types";
import { clearSelectedRun, setFocusedRun } from "@/lib/board/store";
import { runs } from "@/lib/fixtures";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What the record decides for itself.
 *
 * The four columns and the sensor strip are drawn from data and a story shows
 * them; these are the judgements no fixture carries — how much of the field it
 * holds open when it is nearly empty, whether its scrollport is something a
 * keyboard can reach, and which of two different empty states it is in.
 *
 * `next/link` wants an app router mounted, which nothing here is. The record
 * uses it for one thing, the href on the first cell, so an anchor is the whole
 * of what a stand-in has to be.
 */
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  // The focus store is a module singleton shared by the chamber and the
  // record, so a test that marks a row would hand the mark to the next one.
  clearSelectedRun();
  setFocusedRun(null);
});

/** As many rows as asked for, each a distinct run the table can key on. */
function many(count: number): RunSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const base = runs[i % runs.length];
    if (!base) throw new Error("fixtures are empty");
    return { ...base, id: `run-${i}`, pr_number: 100 + i };
  });
}

/** Every fixture run, with nothing live, so `Live` selects none of them. */
function settled(): RunSummary[] {
  return runs.map((run) => ({ ...run, status: "clean" as const }));
}

/** The scrollport is the one element carrying the record's max height. */
function scrollport(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[style*='max-height']");
  if (!node) throw new Error("no scrollport rendered");
  return node;
}

/**
 * jsdom lays nothing out: every box measures zero, so a record is never clipped
 * unless a test says it is. These stub the two reads the measurement makes,
 * which is the whole of what the browser would have told it.
 */
function stubOverflow({ vertical = 0, horizontal = 0 }): () => void {
  const defs = {
    scrollHeight: vertical,
    clientHeight: 0,
    scrollWidth: horizontal,
    clientWidth: 0,
  };
  for (const [name, value] of Object.entries(defs)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
  }
  return () => {
    for (const name of Object.keys(defs)) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}

describe("the record's floor", () => {
  it("holds the field open with ruled lines when it has fewer rows than the floor", () => {
    const { container } = render(<Record runs={runs.slice(0, 2)} />);

    expect(screen.getAllByRole("row")).toHaveLength(3); // two runs and the header
    // Five rows' worth of field, three of them ruled lines rather than rows:
    // decoration, hidden from anyone walking the table.
    const ruled = container.querySelectorAll("[aria-hidden='true'] > div");
    expect(ruled).toHaveLength(3);
  });

  it("draws no ruled lines once the record reaches the floor", () => {
    const { container } = render(<Record runs={many(5)} />);

    expect(container.querySelectorAll("[aria-hidden='true'] > div")).toHaveLength(0);
  });

  it("leaves the ruled lines to the empty block when there is nothing at all", () => {
    const { container } = render(<Record runs={[]} />);

    // The empty block draws its own rhythm across the whole field, so the
    // trailing lines would be a second set drawn through it.
    expect(container.querySelectorAll("[aria-hidden='true'] > div")).toHaveLength(0);
    expect(screen.getByText("No runs yet.")).toBeTruthy();
  });
});

describe("the record's scrollport", () => {
  it("is not a tab stop while it clips nothing", () => {
    render(<Record runs={many(40)} />);

    // Forty rows and still no stop: the row count never decided this.
    expect(scrollport().getAttribute("tabindex")).toBeNull();
    expect(screen.queryByRole("region", { name: "The record, scrollable" })).toBeNull();
  });

  it("is reachable and named once it clips vertically", () => {
    const restore = stubOverflow({ vertical: 400 });
    try {
      render(<Record runs={many(6)} />);

      // Six rows, well under the ceiling: the 70vh cap is what clipped it.
      const region = screen.getByRole("region", { name: "The record, scrollable" });
      expect(region.getAttribute("tabindex")).toBe("0");
    } finally {
      restore();
    }
  });

  it("is reachable and named once it clips sideways", () => {
    const restore = stubOverflow({ horizontal: 600 });
    try {
      render(<Record runs={many(2)} />);

      // Two rows and no vertical clipping at all — seven columns on a phone.
      const region = screen.getByRole("region", { name: "The record, scrollable" });
      expect(region.getAttribute("tabindex")).toBe("0");
    } finally {
      restore();
    }
  });
});

describe("the empty record", () => {
  it("keeps the column header, so the record is present rather than replaced", () => {
    render(<Record runs={[]} />);

    const header = screen.getAllByRole("row")[0];
    if (!header) throw new Error("no header row rendered");
    expect(within(header).getByText("Pull request")).toBeTruthy();
    expect(within(header).getByText("Verdict")).toBeTruthy();
  });

  it("offers the install, which is the only thing a board with no runs can do", () => {
    render(<Record runs={[]} />);

    const install = screen.getByRole("link", { name: "Install Cujo" });
    expect(install.getAttribute("href")).toBe("https://github.com/apps/cujo-guard");
    expect(screen.queryByRole("button", { name: "Show every run" })).toBeNull();
  });

  it("names the filter that emptied it, and offers the undo instead of the install", () => {
    render(<Record runs={settled()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Live/ }));

    expect(screen.getByText("Nothing is running.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Install Cujo" })).toBeNull();
    expect(screen.queryByText("No runs yet.")).toBeNull();
  });

  it("puts the record back when the undo is taken", () => {
    render(<Record runs={settled()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Live/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show every run" }));

    expect(screen.getAllByRole("row")).toHaveLength(runs.length + 1);
    expect(screen.queryByText("Nothing is running.")).toBeNull();
  });
});
