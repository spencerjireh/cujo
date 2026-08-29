/**
 * Shared by the two operator route tests. Both build the whole plane through
 * `operatorRoutes`, not their own sub-router, so each one also exercises the
 * Access gate that mounts them — which is the property worth re-checking on
 * every route, and the reason this is one harness rather than two.
 */

import { EventEmitter } from "node:events";
import { createLogger } from "@cujo/log";
import { Hono } from "hono";
import { vi } from "vitest";
import type { DiscordClient } from "../../../src/clients/discord";
import type { GitHubReader } from "../../../src/clients/github";
import { operatorRoutes } from "../../../src/http/operator";
import type { Env } from "../../../src/http/operator/access";
import { requestLogger } from "../../../src/http/request-log";
import type { RunView, Runner } from "../../../src/review/runner.service";
import { Store } from "../../../src/store";

export const AUTH = { "cf-access-jwt-assertion": "good" };

export function build(view: RunView | null, discord?: DiscordClient, github?: GitHubReader) {
  const store = new Store(":memory:");
  // Seed the real store from the same fixture the runner is mocked with, and
  // hand the test the id it was given.
  //
  // A handler that reads through `deps.runs` is reading the production
  // dependency, and against an empty store every such read returns null: the
  // test would pass while exercising nothing. That is not hypothetical — it is
  // why `approve.requested` was first written against `runner.view()`, which
  // the mock answers, rather than against the row that actually holds the
  // delivery. `createRun` mints its own id, so the fixture takes that id
  // rather than the store taking the fixture's.
  let runId = "r1";
  if (view) {
    const { run } = store.runs.createRun({
      repo: view.run.repo,
      prNumber: view.run.prNumber,
      headSha: view.run.headSha,
      sessionId: view.run.sessionId,
      isPublic: view.run.isPublic,
      deliveryId: view.run.deliveryId,
    });
    store.runs.updateRun(run.id, { status: view.run.status });
    runId = run.id;
    (view.run as { id: string }).id = run.id;
  }
  const changes = new EventEmitter();
  const runner = {
    changes,
    view: vi.fn(() => view),
    approve: vi.fn(async () => ({ ok: true as const })),
  } as unknown as Runner;
  // The ray middleware, the way router.ts mounts it. Without it every handler
  // that reaches for c.get("log") throws, and the plane under test is not the
  // plane that runs in production.
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "cujo",
    sink: (line) => lines.push(JSON.parse(line)),
  });
  const routes = operatorRoutes({
    runs: store.runs,
    notifications: store.notifications,
    runner,
    verify: async (t) =>
      t === "good"
        ? { operator: "operator", reason: null }
        : { operator: null, reason: "no_assertion" as const },
    ...(discord ? { discord } : {}),
    ...(github ? { github } : {}),
  });
  const app = new Hono<Env>();
  app.use("*", requestLogger(log, "delegated"));
  app.route("/", routes);
  const logged = (event: string) => lines.filter((line) => line.event === event);
  return { app, store, runner, changes, lines, logged, runId };
}
