import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReactions, Reaction } from "../../src/clients/github-reactions";
import { PrReactor, type PrReactorDeps } from "../../src/notify/reactions.service";
import type { RunView } from "../../src/review/runner.service";
import { CHECK_NAMES, type RunRecord, type RunStatus } from "../../src/review/types";

/** Tests assert on behaviour, not on log output; the sink swallows it. */
const silentLog = createLogger({ service: "cujo", sink: () => {} });

const run = (status: RunStatus, id = "run-1"): RunRecord => ({
  id,
  repo: "o/r",
  prNumber: 7,
  headSha: "h",
  sessionId: "sess-1",
  deliveryId: null,
  turnIds: [],
  status,
  approver: null,
  decidedAt: null,
  isPublic: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const view = (status: RunStatus, id?: string): RunView =>
  ({ run: run(status, id) }) as unknown as RunView;

function fake(set?: (wanted: readonly Reaction[]) => Promise<void>) {
  const calls: Reaction[][] = [];
  const reactions = {
    set: vi.fn(async (_repo: string, _pr: number, wanted: readonly Reaction[]) => {
      calls.push([...wanted]);
      await set?.(wanted);
    }),
  } as unknown as GitHubReactions;
  return { reactions, calls };
}

/** No retry and no waiting unless a test asks for them. */
const build = (reactions: GitHubReactions, extra: Partial<PrReactorDeps> = {}) =>
  new PrReactor({ log: silentLog, reactions, retryDelaysMs: [], ...extra });

describe("PrReactor", () => {
  it("puts the eye on the pull request as soon as the run is claimed", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.markClaimed(run("running"));
    await reactor.flush();
    expect(calls).toEqual([["eyes"]]);
    expect(reactions.set).toHaveBeenCalledWith("o/r", 7, ["eyes"]);
  });

  it.each([
    ["running", ["eyes"]],
    ["blocked_pending", ["eyes", "rocket"]],
    ["clean", ["hooray"]],
    ["blocked_posted", ["-1"]],
    ["denied", ["+1"]],
    ["error", ["confused"]],
  ] as [RunStatus, Reaction[]][])("wears %s as %s", async (status, wanted) => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.onRunChanged(view(status));
    await reactor.flush();
    expect(calls).toEqual([wanted]);
  });

  /**
   * One pull request, one reaction, and possibly several runs. A superseded
   * run no longer describes the pull request, so it writes nothing at all —
   * this is what stops a delayed delivery for an older head from wiping the
   * current run's verdict.
   */
  it("writes nothing for a superseded run", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.onRunChanged(view("superseded"));
    await reactor.flush();
    expect(calls).toEqual([]);
  });

  it("leaves a finished run's verdict alone when an older run is superseded", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    // The current head finished clean...
    reactor.onRunChanged(view("clean", "run-2"));
    // ...and a delayed delivery for an older head is then put to rest.
    reactor.onRunChanged(view("superseded", "run-1"));
    await reactor.flush();
    expect(calls).toEqual([["hooray"]]);
  });

  it("collapses the claim and the first fold, which both want the eye", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.markClaimed(run("running"));
    reactor.onRunChanged(view("running"));
    await reactor.flush();
    expect(calls).toEqual([["eyes"]]);
  });

  it("collapses the per-event storm to one call per distinct reaction set", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    for (let i = 0; i < CHECK_NAMES.length * 3; i++) reactor.onRunChanged(view("running"));
    reactor.onRunChanged(view("clean"));
    await reactor.flush();
    expect(calls).toEqual([["eyes"], ["hooray"]]);
  });

  it("keeps calls in order, so the pull request cannot settle on a state the run left", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reactions, calls } = fake(async (wanted) => {
      if (wanted[0] === "eyes") await gate;
    });
    const reactor = build(reactions);
    reactor.onRunChanged(view("running"));
    reactor.onRunChanged(view("clean"));
    // The queue is a promise chain, so let it start the first call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second is still behind the gate rather than past it.
    expect(calls).toEqual([["eyes"]]);
    release();
    await reactor.flush();
    expect(calls).toEqual([["eyes"], ["hooray"]]);
  });

  /**
   * A terminal status is the last event a run produces, so there is no later
   * change to retry on: without this, one transient failure would leave the
   * pull request wearing the previous status forever.
   */
  it("retries a failed call, so a terminal status is not lost to a blip", async () => {
    let failures = 2;
    const { reactions, calls } = fake(async () => {
      if (failures-- > 0) throw new Error("502 from GitHub");
    });
    const slept: number[] = [];
    const reactor = build(reactions, {
      retryDelaysMs: [1_000, 3_000],
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });
    reactor.onRunChanged(view("clean"));
    await reactor.flush();
    expect(calls).toEqual([["hooray"], ["hooray"], ["hooray"]]);
    expect(slept).toEqual([1_000, 3_000]);
  });

  it("abandons a retry once a newer status is queued behind it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reactions, calls } = fake(async (wanted) => {
      if (wanted[0] === "eyes") throw new Error("502 from GitHub");
    });
    const reactor: PrReactor = new PrReactor({
      log: silentLog,
      reactions,
      retryDelaysMs: [1_000, 3_000],
      // The newer status arrives while the failing call is backing off.
      sleepImpl: async () => {
        reactor.onRunChanged(view("clean"));
      },
    });
    reactor.onRunChanged(view("running"));
    await reactor.flush();
    // One attempt at the eye, then straight to the state the run is in now.
    expect(calls).toEqual([["eyes"], ["hooray"]]);
    error.mockRestore();
  });

  it("never lets GitHub fail a run, and retries at the next change", async () => {
    // Asserted on the captured log rather than a console spy: the failure is
    // now a named event, so the test can say which one it expects instead of
    // only that something was printed.
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
    let fail = true;
    const { reactions, calls } = fake(async () => {
      if (fail) throw new Error("502 from GitHub");
    });
    const reactor = build(reactions, { log });
    expect(() => reactor.onRunChanged(view("running"))).not.toThrow();
    await reactor.flush();
    const failed = lines.filter((l) => l.event === "discord.notify.failed");
    expect(failed[0]).toMatchObject({ reason: "reaction_gave_up", repo: "o/r", pr_number: 7 });
    // The pre-filter was cleared, so the same status is attempted again.
    fail = false;
    reactor.onRunChanged(view("running"));
    await reactor.flush();
    expect(calls).toEqual([["eyes"], ["eyes"]]);
  });

  it("ignores a null view", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.onRunChanged(null);
    await reactor.flush();
    expect(calls).toEqual([]);
  });

  it("tracks each run separately", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.onRunChanged(view("running", "run-1"));
    reactor.markClaimed(run("running", "run-2"));
    await reactor.flush();
    expect(calls).toEqual([["eyes"], ["eyes"]]);
  });

  /**
   * The reactor lives as long as the process and sees every run it handles, so
   * what it remembers has to be bounded. An evicted run simply re-applies,
   * which is idempotent.
   */
  it("bounds what it remembers, evicting the least recently seen run", async () => {
    const { reactions, calls } = fake();
    const reactor = build(reactions);
    reactor.onRunChanged(view("running", "run-oldest"));
    for (let i = 0; i < 512; i++) reactor.onRunChanged(view("running", `run-${i}`));
    await reactor.flush();
    expect(calls).toHaveLength(513);
    // Still remembered, so the same state does not call again.
    reactor.onRunChanged(view("running", "run-511"));
    // Evicted, so it does.
    reactor.onRunChanged(view("running", "run-oldest"));
    await reactor.flush();
    expect(calls).toHaveLength(514);
  });
});
