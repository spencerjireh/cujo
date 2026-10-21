import type { BotState, Health, InstanceSettings, OwnedRepository } from "@/lib/api/owner-client";
import { ownerRuns } from "@/lib/fixtures";
import {
  isClosed,
  lastRunPerRepository,
  latestPerPullRequest,
  needsYou,
  openBlocks,
  setupSteps,
} from "@/lib/owner/activity";
import { describe, expect, it } from "vitest";

const bot: BotState = {
  app: {
    slug: "cujo",
    name: "Cujo",
    htmlUrl: "https://github.com/apps/cujo",
    permissions: {},
    events: [],
  },
  permissions: [{ name: "checks", needed: "write", held: "write", ok: true }],
  installations: [
    {
      id: 1,
      account: { login: "octocat", type: "User" },
      suspended: false,
      repositorySelection: "selected",
      repositories: 1,
    },
  ],
  deliveries: [],
};
const health: Health = {
  harness: "ready",
  store: "ok",
  configured: true,
  uptimeMs: 1,
  ready: true,
};
const settings = {
  model: "anthropic/claude-sonnet-5-5",
  modelProviders: [{ kind: "anthropic", name: "anthropic", apiKey: "****1234" }],
} as unknown as InstanceSettings;
const repository: OwnedRepository = {
  repo: "octocat/app",
  displayName: "octocat/app",
  installationId: 1,
  isPrivate: false,
  enabled: true,
  addedAt: "2026-01-01T00:00:00Z",
  removedAt: null,
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("setupSteps (decision 175)", () => {
  it("passes every step on a configured instance", () => {
    const steps = setupSteps({ bot, settings, health, repositories: [repository] });
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
  });

  it("fails each step on its own input, and says why", () => {
    const steps = setupSteps({
      bot: {
        ...bot,
        permissions: [{ name: "checks", needed: "write", held: "read", ok: false }],
      },
      settings: { ...settings, model: null, modelProviders: [] },
      health: { ...health, configured: false },
      repositories: [{ ...repository, enabled: false }],
    });
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false]);
    expect(steps[0]?.detail).toContain("checks (write, holds read)");
    expect(steps[2]?.detail).toContain("No model is chosen");
  });

  it("does not pass a step whose input did not load", () => {
    const steps = setupSteps({
      bot: null,
      settings: undefined,
      health: undefined,
      repositories: undefined,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[0]?.detail).toContain("GitHub did not answer");
  });

  it("does not count a removed repository as switched on", () => {
    const steps = setupSteps({
      bot,
      settings,
      health,
      repositories: [{ ...repository, removedAt: "2026-02-01T00:00:00Z" }],
    });
    expect(steps[3]?.done).toBe(false);
  });
});

describe("runs per pull request and per repository", () => {
  it("keeps only the newest run of each pull request", () => {
    const latest = latestPerPullRequest(ownerRuns);
    const allowlist = latest.filter((r) => r.pr_number === 210);
    expect(allowlist.map((r) => r.status)).toEqual(["clean"]);
  });

  it("lists blocked and errored pull requests, newest first, and not a block a newer run replaced", () => {
    const ids = needsYou(ownerRuns).map((r) => r.id);
    expect(ids).toContain("run-10");
    expect(ids).toContain("run-1");
    expect(ids).not.toContain("run-12");
    expect(ids[0]).toBe("run-10");
  });

  it("leaves out a pull request that merged or closed (decision 179)", () => {
    const ids = needsYou(ownerRuns).map((r) => r.id);
    expect(ids).not.toContain("run-15");
    expect(ids).not.toContain("run-16");
    const merged = ownerRuns.find((r) => r.id === "run-15");
    expect(merged && isClosed(merged)).toBe(true);
    // Not known is open: the board's runs carry no state and still count.
    expect(ownerRuns.find((r) => r.id === "run-1")?.pr_state).toBeUndefined();
  });

  it("does not count a block on a pull request that merged", () => {
    const merged = ownerRuns.map((r) =>
      r.repo === "spencerjireh/orders-api" ? { ...r, pr_state: "merged" as const } : r,
    );
    expect(openBlocks(merged, "spencerjireh/orders-api")).toBe(0);
  });

  it("finds each repository's newest run and counts its open blocks", () => {
    const last = lastRunPerRepository(ownerRuns);
    expect(last.get("spencerjireh/notes")?.id).toBe("run-10");
    expect(openBlocks(ownerRuns, "spencerjireh/cujo")).toBe(0);
    expect(openBlocks(ownerRuns, "SpencerJireh/Orders-API")).toBe(2);
  });
});
