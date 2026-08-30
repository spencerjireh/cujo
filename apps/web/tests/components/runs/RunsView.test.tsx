// @vitest-environment jsdom

import { RunsView } from "@/components/runs/RunsView";
import { runsListOptions } from "@/lib/api/queries";
import { clearSelectedRun, setFocusedRun } from "@/lib/board/store";
import { runs } from "@/lib/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the dwell decides for itself (decision 102).
 *
 * The swap between the readings and the key is an opacity change over two
 * cells that stay mounted, so jsdom cannot see it happen — but `aria-hidden`
 * flips with it, which is the part a screen reader sees too, and that is
 * what these tests read. The chamber is replaced by a stub that reports
 * itself live on mount, because a WebGL scene is the one thing jsdom cannot
 * give; the readings, the key and the record render for real.
 *
 * The clock is fake throughout. The fixtures are settled (nothing running)
 * so the poll interval is the quiet thirty seconds and no refetch can land
 * inside a test's few seconds of borrowed time; the client is mocked to the
 * same runs as belt and braces, so even one that does answers with the
 * board it started with.
 */

vi.mock("@/components/board/Chamber", async () => {
  const { useEffect } = await import("react");
  return {
    Chamber: ({ onStatus }: { onStatus: (status: "live") => void }) => {
      useEffect(() => {
        onStatus("live");
      }, [onStatus]);
      return null;
    },
  };
});

/* `next/link` wants an app router mounted, which nothing here is; the same
   stand-in Record.test.tsx uses. */
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/client", () => ({
  fetchRuns: vi.fn(async () => ({ runs: settled() })),
  fetchRun: vi.fn(),
}));

/** Every fixture run, settled: nothing live, so the board is on the quiet poll. */
function settled() {
  return runs.map((run) => ({ ...run, status: "clean" as const }));
}

/**
 * The hero's two stacked cells: the readings, and the key that replaces
 * them. Told apart by the "live now" reading, which only the readings cell
 * has, and the key cell's `self-end`, which nothing else in the hero does.
 */
function cells(): { readings: Element; key: Element } {
  const readings = screen.getByText("live now").closest("div[class*='col-start-1']");
  const key = readings?.parentElement?.querySelector("div[class*='self-end']");
  if (!readings || !key) throw new Error("the hero did not render both cells");
  return { readings, key };
}

function board() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(runsListOptions().queryKey, { runs: settled() });
  render(
    <QueryClientProvider client={client}>
      <RunsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  /* The sentinel asks the browser who is on screen; jsdom has no answer. */
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  /* The focus store is a module singleton; a run left focused would hand
     itself to the next test. */
  clearSelectedRun();
  setFocusedRun(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the hero's key waits for a stay", () => {
  it("does not swap the readings on contact", () => {
    board();
    act(() => setFocusedRun("run-1"));
    act(() => vi.advanceTimersByTime(2999));
    const { readings, key } = cells();
    expect(readings.getAttribute("aria-hidden")).toBe(null);
    expect(key.getAttribute("aria-hidden")).toBe("true");
  });

  it("brings the key after three seconds on one specimen", () => {
    board();
    act(() => setFocusedRun("run-1"));
    act(() => vi.advanceTimersByTime(3000));
    const { readings, key } = cells();
    expect(readings.getAttribute("aria-hidden")).toBe("true");
    expect(key.getAttribute("aria-hidden")).toBe(null);
  });

  it("returns the readings at once on a leave", () => {
    board();
    act(() => setFocusedRun("run-1"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => setFocusedRun(null));
    /* No clock advanced: the leave is immediate, not another dwell. */
    const { readings, key } = cells();
    expect(readings.getAttribute("aria-hidden")).toBe(null);
    expect(key.getAttribute("aria-hidden")).toBe("true");
  });

  it("restarts the wait when the focused run changes", () => {
    board();
    act(() => setFocusedRun("run-1"));
    act(() => vi.advanceTimersByTime(2999));
    act(() => setFocusedRun("run-2"));
    act(() => vi.advanceTimersByTime(2999));
    /* Nearly six seconds of pointer, but never three on one specimen. */
    const { readings } = cells();
    expect(readings.getAttribute("aria-hidden")).toBe(null);
    act(() => vi.advanceTimersByTime(1));
    const { key } = cells();
    expect(key.getAttribute("aria-hidden")).toBe(null);
  });

  it("keeps the key on a move to another specimen once shown", () => {
    board();
    act(() => setFocusedRun("run-1"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => setFocusedRun("run-2"));
    /* No clock advanced: a move does not take back a committed key. */
    const { key } = cells();
    expect(key.getAttribute("aria-hidden")).toBe(null);
  });
});
