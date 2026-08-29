/**
 * The reconciler behind the `repository` webhook (decision 34).
 *
 * The behaviour worth pinning is what it does when GitHub does not answer
 * cleanly: a 404 means private, and anything else means leave the stamp alone.
 * Fail-closed on every error would take the whole public board dark on a
 * five-minute GitHub blip, protecting nothing — the repo did not go private.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader } from "../../src/clients/github";
import { VisibilityService } from "../../src/review/visibility.service";
import { Store } from "../../src/store";

/** Tests assert on behaviour, not on log output; the sink swallows it. */
const silentLog = createLogger({ service: "cujo", sink: () => {} });

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

function build(answers: Record<string, "public" | "private" | "unknown">, intervalMs = 1000) {
  const store = new Store(":memory:");
  const repoIsPublic = vi.fn(async (repo: string) => answers[repo] ?? "unknown");
  const github = { repoIsPublic } as unknown as GitHubReader;
  const service = new VisibilityService({ log: silentLog, runs: store.runs, github, intervalMs });
  return { store, service, repoIsPublic };
}

describe("VisibilityService.sweep", () => {
  it("re-stamps a repo that went private", async () => {
    const { store, service } = build({ "o/r": "private" });
    const run = store.runs.createRun(head).run;
    const result = await service.sweep();
    expect(result).toMatchObject({ checked: 1, changed: 1, unknown: 0 });
    expect(store.runs.getRun(run.id)?.isPublic).toBe(false);
    expect(store.runs.listPublicRuns()).toEqual([]);
  });

  /**
   * The first sweep is what makes rows written before the column existed
   * visible; without it the board launches empty.
   */
  it("backfills a run whose visibility was never answered", async () => {
    const { store, service } = build({ "o/r": "public" });
    const run = store.runs.createRun({ ...head, isPublic: false }).run;
    expect(store.runs.listPublicRuns()).toEqual([]);
    await service.sweep();
    expect(store.runs.getRun(run.id)?.isPublic).toBe(true);
    expect(store.runs.listPublicRuns().map((r) => r.run.id)).toEqual([run.id]);
  });

  it("leaves the stamp alone when GitHub could not be asked", async () => {
    const { store, service } = build({ "o/r": "unknown" });
    const run = store.runs.createRun(head).run;
    const result = await service.sweep();
    expect(result).toMatchObject({ changed: 0, unknown: 1 });
    expect(store.runs.getRun(run.id)?.isPublic).toBe(true);
  });

  it("changes nothing when every answer already matches", async () => {
    const { store, service } = build({ "o/r": "public" });
    store.runs.createRun(head);
    expect(await service.sweep()).toMatchObject({ checked: 1, changed: 0, unknown: 0 });
  });

  it("asks about each repo once, not once per run", async () => {
    const { store, service, repoIsPublic } = build({ "o/r": "public", "o/other": "private" });
    store.runs.createRun(head);
    store.runs.createRun({ ...head, headSha: "h2" });
    store.runs.createRun({ ...head, repo: "o/other" });
    await service.sweep();
    expect(repoIsPublic).toHaveBeenCalledTimes(2);
  });
});

describe("VisibilityService.start", () => {
  it("sweeps immediately, then on the interval", async () => {
    vi.useFakeTimers();
    try {
      const { store, service, repoIsPublic } = build({ "o/r": "public" }, 1000);
      store.runs.createRun(head);
      service.start();
      await vi.waitFor(() => expect(repoIsPublic).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1000);
      expect(repoIsPublic).toHaveBeenCalledTimes(2);
      service.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(repoIsPublic).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing at all when the interval is zero", async () => {
    const { store, service, repoIsPublic } = build({ "o/r": "public" }, 0);
    store.runs.createRun(head);
    service.start();
    await Promise.resolve();
    expect(repoIsPublic).not.toHaveBeenCalled();
  });
});
