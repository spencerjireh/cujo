/**
 * The composed app, built the way index.ts builds it. Shared by the router
 * test and the webhook test, because both assert on behaviour that only exists
 * once the host dispatch, the Access gate and the ingress routes are wired
 * together — mounting a sub-router on its own would not reproduce any of it.
 */

import { type Level, createLogger } from "@cujo/log";
import { vi } from "vitest";
import type { GitHubReader } from "../../src/clients/github";
import { createApp } from "../../src/http/router";
import type { Runner } from "../../src/review/runner.service";
import { Store } from "../../src/store";

export const UI = "cujo.test";
export const HOOK = "cujo-ingress.test";
export const INTERNAL = "cujo-internal.test";

/** A fake runner that records the store transitions the real one would make. */
export function fakeRunner(store: Store): Runner {
  return {
    view: () => null,
    start: vi.fn(async () => {}),
    approve: vi.fn(),
    fail: vi.fn((runId: string) => store.runs.updateRun(runId, { status: "error" })),
    supersede: vi.fn(async (runId: string) => {
      store.runs.updateRun(runId, { status: "superseded" });
    }),
  } as unknown as Runner;
}

export const prOf = (headSha: string) => ({
  repo: "o/r",
  prNumber: 7,
  title: "t",
  body: "",
  baseSha: "b",
  headSha,
  cloneUrl: "https://github.com/o/r.git",
  changedFiles: ["a.py"],
});

export function build(
  overrides: Partial<{
    runner: Runner;
    github: GitHubReader;
    interactions: boolean;
    streamLimit: number;
    level: Level;
    isReady: () => boolean;
    /** Overridden by the secret sweep, so the value under test is the real one. */
    webhookSecret: string;
    /** The one call the webhook makes to another service, so the one that can fail. */
    createSession: () => Promise<string>;
    /** Design 2. Absent means `/cujo` on a pull request is not configured. */
    prCommands: { handle: (command: unknown) => Promise<void> };
    /** Design 3. Absent means `@cujo-guard` is not configured. */
    converse: { handle: (request: unknown) => Promise<void> };
  }> = {},
) {
  const store = new Store(":memory:");
  // The captured log. A sink rather than a console spy, because the logger
  // takes one for exactly this reason and nothing in this repo spies on
  // console. Parsed eagerly so a test asserts on fields, not on substrings.
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "cujo",
    level: overrides.level ?? "info",
    sink: (line) => lines.push(JSON.parse(line)),
  });
  /** Every line for one event name, in order. */
  const logged = (event: string) => lines.filter((line) => line.event === event);
  const runner = overrides.runner ?? fakeRunner(store);
  // Every run the webhook decided was worth starting, in order.
  const claimed: string[] = [];
  // Resolves once the background preparation of a run has settled.
  const settled: Array<(runId: string) => void> = [];
  const nextSettled = () => new Promise<string>((resolve) => settled.push(resolve));
  const github =
    overrides.github ??
    ({
      alreadyReviewed: vi.fn(async () => false),
      pullRequest: vi.fn(async () => prOf("h")),
    } as unknown as GitHubReader);
  const app = createApp({
    log,
    uiHost: UI,
    internalHost: INTERNAL,
    webhookHost: HOOK,
    api: {
      runs: store.runs,
      notifications: store.notifications,
      runner,
      verify: async (t) =>
        t === "good"
          ? { operator: "op@example.com", reason: null }
          : { operator: null, reason: "no_assertion" as const },
    },
    public: {
      runs: store.runs,
      runner,
      streamLimit: overrides.streamLimit ?? 200,
    },
    webhook: {
      log,
      secret: overrides.webhookSecret ?? "s3",
      github,
      store: store.runs,
      runner,
      createSession: overrides.createSession ?? (async () => "sess-1"),
      ...(overrides.isReady ? { isReady: overrides.isReady } : {}),
      reviewRunId: (run) => (run.isPublic ? run.id : ""),
      onClaimed: (run) => claimed.push(run.id),
      onSettled: (runId) => settled.shift()?.(runId),
      ...(overrides.prCommands ? { prCommands: overrides.prCommands as never } : {}),
      ...(overrides.converse ? { converse: overrides.converse as never } : {}),
    },
    ...(overrides.interactions
      ? {
          interactions: {
            log,
            publicKey: "ab".repeat(32),
            store: store.notifications,
            discord: {} as never,
            github,
            links: {
              uiBaseUrl: "https://cujo-admin.example.com",
              publicBaseUrl: "https://cujo.example.com",
            },
            defaultGuild: null,
          },
        }
      : {}),
  });
  return { app, store, runner, github, nextSettled, lines, logged, claimed };
}

export const req = (host: string, path: string, init?: RequestInit) =>
  new Request(`http://${host}${path}`, { ...init, headers: { host, ...(init?.headers ?? {}) } });
