// @vitest-environment jsdom

import { VerdictCard } from "@/components/run/VerdictCard";
import { run } from "@/lib/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * What the card is since decision 103: the verdict alone.
 *
 * The run below is the fixture with a review posted and two criticals in it
 * — the exact run the link used to appear for — so the absence these tests
 * hold is the absence decision 103 made. The counts are asserted alongside
 * so the absence cannot be satisfied by an empty card: the status and the
 * findings stay, and only the way off the page is gone.
 */

afterEach(cleanup);

describe("the verdict card does not link out (decision 103)", () => {
  it("renders no review link for a run whose review was posted", () => {
    render(<VerdictCard run={run()} />);
    expect(screen.queryByText("Read the review on GitHub")).toBe(null);
    expect(document.querySelector('a[href^="https://github.com/"]')).toBe(null);
  });

  it("still states the counts the reader came for", () => {
    render(<VerdictCard run={run()} />);
    expect(screen.getByText("2 critical")).toBeTruthy();
    expect(screen.getByText("1 warn")).toBeTruthy();
    expect(screen.getByText("1 info")).toBeTruthy();
  });
});
