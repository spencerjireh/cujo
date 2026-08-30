import type { SetupTimings } from "@/lib/api/types";
import { setupWindow } from "@/lib/board/setup";
import { describe, expect, it } from "vitest";

const T0 = "2026-08-28T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

function setup(over: Partial<SetupTimings> = {}): SetupTimings {
  return {
    turnCreatedAt: T0,
    sandboxCreatedAt: at(40),
    agentStartedAt: at(45),
    firstCheckAt: at(100),
    messages: 6,
    ms: 55_000,
    ...over,
  };
}

describe("setupWindow", () => {
  it("measures the window from the first turn to the first check", () => {
    const window = setupWindow(setup());
    expect(window?.lengthMs).toBe(100_000);
    expect(window?.messages).toBe(6);
  });

  it("reports nothing for a run that carries no setup at all", () => {
    expect(setupWindow(null)).toBeNull();
    expect(setupWindow(undefined)).toBeNull();
  });

  it("refuses a window whose ends are not both known", () => {
    expect(setupWindow(setup({ turnCreatedAt: null }))).toBeNull();
    // A run whose first check never arrived has a setup that did not finish,
    // which is not the same thing as a window of some length.
    expect(setupWindow(setup({ firstCheckAt: null }))).toBeNull();
  });

  it("refuses a window that ends before it starts", () => {
    expect(setupWindow(setup({ firstCheckAt: at(-10) }))).toBeNull();
  });

  it("draws provisioning as a share of the window", () => {
    expect(setupWindow(setup())?.provisionShare).toBeCloseTo(0.4, 5);
  });

  it("reports no provisioning share on a re-run, rather than zero", () => {
    // The sandbox was already there, which is why a re-run is faster. Zero
    // would claim provisioning took no time at all.
    expect(setupWindow(setup({ sandboxCreatedAt: null }))?.provisionShare).toBeNull();
  });

  it("never lets provisioning draw wider than the window it sits in", () => {
    const window = setupWindow(setup({ sandboxCreatedAt: at(500) }));
    expect(window?.provisionShare).toBe(1);
  });

  it("prefers the thinking span apps/cujo already settled", () => {
    // The stamps would give 55s here too; what is being pinned is that the
    // published number wins, so the two sides never disagree by a millisecond.
    expect(setupWindow(setup({ ms: 12_345 }))?.thinkingMs).toBe(12_345);
  });

  it("falls back to the stamps when the run predates the settled span", () => {
    expect(setupWindow(setup({ ms: undefined }))?.thinkingMs).toBe(55_000);
  });

  it("reports no thinking span when neither the field nor the stamps support one", () => {
    expect(setupWindow(setup({ ms: undefined, agentStartedAt: null }))?.thinkingMs).toBeNull();
  });

  it("keeps a zero-length window and gives it no shares to divide", () => {
    const window = setupWindow(setup({ firstCheckAt: T0, sandboxCreatedAt: T0 }));
    expect(window?.lengthMs).toBe(0);
    expect(window?.provisionShare).toBeNull();
  });
});
