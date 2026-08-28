/**
 * The composed app, built the way index.ts builds it. Shared by the router
 * test and the webhook test, because both assert on behaviour that only exists
 * once the host dispatch, the Access gate and the ingress routes are wired
 * together — mounting a sub-router on its own would not reproduce any of it.
 */

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
  }> = {},
) {
  const store = new Store(":memory:");
  const runner = overrides.runner ?? fakeRunner(store);
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
    uiHost: UI,
    internalHost: INTERNAL,
    webhookHost: HOOK,
    api: {
      runs: store.runs,
      notifications: store.notifications,
      runner,
      verify: async (t) => (t === "good" ? "op@example.com" : null),
    },
    public: {
      runs: store.runs,
      runner,
      streamLimit: overrides.streamLimit ?? 200,
    },
    webhook: {
      secret: "s3",
      github,
      store: store.runs,
      runner,
      createSession: async () => "sess-1",
      onSettled: (runId) => settled.shift()?.(runId),
    },
    ...(overrides.interactions
      ? {
          interactions: {
            publicKey: "ab".repeat(32),
            store: store.notifications,
            discord: {} as never,
            github,
            links: {
              uiBaseUrl: "https://cujo-admin.example.com",
              publicBaseUrl: "https://cujo.example.com",
            },
          },
        }
      : {}),
  });
  return { app, store, runner, github, nextSettled };
}

export const req = (host: string, path: string, init?: RequestInit) =>
  new Request(`http://${host}${path}`, { ...init, headers: { host, ...(init?.headers ?? {}) } });
