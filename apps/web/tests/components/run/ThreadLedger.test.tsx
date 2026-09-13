// @vitest-environment jsdom

import { ThreadLedger } from "@/components/run/ThreadLedger";
import type { RunLedger } from "@/lib/api/types";
import { run } from "@/lib/fixtures";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const ledger = (): RunLedger => run().ledger as RunLedger;

describe("the thread ledger (decision 141)", () => {
  it("splits the parent from the checks, cache reads included", () => {
    render(<ThreadLedger ledger={ledger()} />);
    // main: 9_600 + 73_000; checks: the four rows' input + cache read.
    const parent = screen.getByText("parent").nextElementSibling;
    expect(parent?.textContent).toContain("82.6k");
    const checks = screen.getByText("checks").nextElementSibling;
    expect(checks?.textContent).toContain("465.2k");
    expect(checks?.textContent).toContain("(85%)");
  });

  it("numbers a second attempt and leaves the first unnumbered", () => {
    const tests = ledger().threads.find((t) => t.title === "tests");
    if (!tests) throw new Error("fixture has no tests row");
    const two: RunLedger = {
      threads: [
        { ...tests, attempt: 1 },
        { ...tests, attempt: 2 },
      ],
      largestToolResults: [],
    };
    render(<ThreadLedger ledger={two} />);
    const rows = screen.getAllByRole("rowheader");
    expect(rows[0]?.textContent).toBe("tests");
    expect(rows[1]?.textContent).toBe("tests #2");
  });

  it("lists the largest tool results largest first, with the error marked", () => {
    render(<ThreadLedger ledger={ledger()} />);
    const table = screen.getByRole("table", { name: "Largest tool results" });
    const rows = within(table).getAllByRole("row");
    expect(rows[0]?.textContent).toContain("31.0 kB");
    expect(rows[4]?.textContent).toContain("error");
    expect(rows[0]?.textContent).not.toContain("error");
  });

  it("shows a dash where no message reported reasoning tokens", () => {
    render(<ThreadLedger ledger={ledger()} />);
    const table = screen.getByRole("table", { name: "By thread" });
    const main = within(table).getAllByRole("row")[1];
    expect(main?.textContent).toContain("—");
  });

  it("renders nothing for a run recorded before the ledger existed", () => {
    const { container } = render(<ThreadLedger ledger={null} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    const empty = render(<ThreadLedger ledger={{ threads: [], largestToolResults: [] }} />);
    expect(empty.container.innerHTML).toBe("");
  });
});
