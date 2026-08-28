/**
 * Shared by the two operator route tests. Both build the whole plane through
 * `operatorRoutes`, not their own sub-router, so each one also exercises the
 * Access gate that mounts them — which is the property worth re-checking on
 * every route, and the reason this is one harness rather than two.
 */

import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { DiscordClient } from "../../../src/clients/discord";
import type { GitHubReader } from "../../../src/clients/github";
import { operatorRoutes } from "../../../src/http/operator";
import type { RunView, Runner } from "../../../src/review/runner.service";
import { Store } from "../../../src/store";

export const AUTH = { "cf-access-jwt-assertion": "good" };

export function build(view: RunView | null, discord?: DiscordClient, github?: GitHubReader) {
  const store = new Store(":memory:");
  const changes = new EventEmitter();
  const runner = {
    changes,
    view: vi.fn(() => view),
    approve: vi.fn(async () => ({ ok: true as const })),
  } as unknown as Runner;
  const app = operatorRoutes({
    runs: store.runs,
    notifications: store.notifications,
    runner,
    verify: async (t) => (t === "good" ? "op@example.com" : null),
    ...(discord ? { discord } : {}),
    ...(github ? { github } : {}),
  });
  return { app, store, runner, changes };
}
