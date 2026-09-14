import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";
import { DETONATION_CACHE_TTL_MS } from "../../src/store/detonations";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };
const at = "2026-09-13T12:00:00.000Z";
const report = { dependency: "humanize==4.9.0", source: "pypi", install_ok: true };

describe("the detonation cache (decision 145)", () => {
  it("returns an entry younger than seven days and not one older", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.detonations.put({
      source: "pypi",
      specifier: "humanize==4.9.0",
      report,
      runId: run.id,
      createdAt: at,
    });
    const day6 = new Date(Date.parse(at) + 6 * 24 * 60 * 60 * 1000);
    const day8 = new Date(Date.parse(at) + 8 * 24 * 60 * 60 * 1000);
    expect(store.detonations.get("pypi", "humanize==4.9.0", day6)).toMatchObject({
      source: "pypi",
      specifier: "humanize==4.9.0",
      report,
      runId: run.id,
      runIsPublic: true,
      createdAt: at,
    });
    expect(store.detonations.get("pypi", "humanize==4.9.0", day8)).toBeNull();
    expect(DETONATION_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("refreshes the stamp and the report on a second write for the same key", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.detonations.put({
      source: "pypi",
      specifier: "x==1",
      report: { v: 1 },
      runId: run.id,
      createdAt: at,
    });
    const later = "2026-09-20T12:00:00.000Z";
    store.detonations.put({
      source: "pypi",
      specifier: "x==1",
      report: { v: 2 },
      runId: run.id,
      createdAt: later,
    });
    const got = store.detonations.get("pypi", "x==1", new Date(Date.parse(later) + 1000));
    expect(got?.report).toEqual({ v: 2 });
    expect(got?.createdAt).toBe(later);
  });

  it("keys on the source, so pypi and npm never collide", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.detonations.put({
      source: "pypi",
      specifier: "left-pad==1.3.0",
      report: { s: "pypi" },
      runId: run.id,
      createdAt: at,
    });
    store.detonations.put({
      source: "npm",
      specifier: "left-pad@1.3.0",
      report: { s: "npm" },
      runId: run.id,
      createdAt: at,
    });
    const now = new Date(Date.parse(at) + 1);
    expect(store.detonations.get("pypi", "left-pad==1.3.0", now)?.report).toEqual({ s: "pypi" });
    expect(store.detonations.get("npm", "left-pad@1.3.0", now)?.report).toEqual({ s: "npm" });
    expect(store.detonations.get("npm", "left-pad==1.3.0", now)).toBeNull();
  });

  it("survives the run that wrote it being deleted, and then says the run is not public", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.detonations.put({
      source: "pypi",
      specifier: "x==1",
      report,
      runId: run.id,
      createdAt: at,
    });
    store.runs.deleteRun(run.id);
    const got = store.detonations.get("pypi", "x==1", new Date(Date.parse(at) + 1));
    expect(got?.runId).toBe(run.id);
    expect(got?.runIsPublic).toBe(false);
  });

  it("keeps what a run was briefed with, and lets it go with the run (decision 148)", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.detonations.putForRun(run.id, [
      {
        source: "pypi",
        specifier: "humanize==4.9.0",
        report,
        cachedFromRun: "run-earlier",
        cachedAt: at,
      },
      {
        source: "npm",
        specifier: "left-pad@1.3.0",
        report: { s: "npm" },
        cachedFromRun: null,
        cachedAt: at,
      },
    ]);
    expect(store.detonations.forRun(run.id)).toEqual([
      {
        source: "pypi",
        specifier: "humanize==4.9.0",
        report,
        cachedFromRun: "run-earlier",
        cachedAt: at,
      },
      {
        source: "npm",
        specifier: "left-pad@1.3.0",
        report: { s: "npm" },
        cachedFromRun: null,
        cachedAt: at,
      },
    ]);
    expect(store.detonations.forRun("nobody")).toEqual([]);
    store.runs.deleteRun(run.id);
    expect(store.detonations.forRun(run.id)).toEqual([]);
  });

  it("says whether the source run was public", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun({ ...head, isPublic: false });
    store.detonations.put({
      source: "gem",
      specifier: "rack:3.0.8",
      report,
      runId: run.id,
      createdAt: at,
    });
    expect(
      store.detonations.get("gem", "rack:3.0.8", new Date(Date.parse(at) + 1))?.runIsPublic,
    ).toBe(false);
  });
});
