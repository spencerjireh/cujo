/**
 * The public plane on its own, with no gate around it.
 *
 * There is no `verify` in these deps and no header in any request below, and
 * that absence is the assertion: if a route on this plane ever needed one, it
 * would not belong here. The composed-app test in `../router.test.ts` is what
 * proves the mount point, and it is deliberately a different file.
 */

import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { publicRoutes } from "../../../src/http/public";
import { emptyProjection } from "../../../src/review/fold";
import type { RunView, Runner } from "../../../src/review/runner.service";
import type { Projection, RunRecord } from "../../../src/review/types";
import { Store } from "../../../src/store";

export function runOf(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    repo: "o/r",
    prNumber: 7,
    headSha: "abc1234",
    sessionId: "s1",
    turnIds: ["t1"],
    status: "clean",
    approver: null,
    decidedAt: null,
    isPublic: true,
    deliveryId: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:01:00.000Z",
    ...overrides,
  };
}

export function viewOf(run: RunRecord, projection: Partial<Projection> = {}): RunView {
  return { run, projection: { ...emptyProjection(), status: run.status, ...projection } };
}

export function build(view: RunView | null, options: { streamLimit?: number } = {}) {
  const store = new Store(":memory:");
  const changes = new EventEmitter();
  // Mutable so a test can flip what `view()` answers mid-stream.
  let current = view;
  const runner = {
    changes,
    view: vi.fn(() => current),
  } as unknown as Runner;
  const { app, limit } = publicRoutes({
    runs: store.runs,
    runner,
    streamLimit: options.streamLimit ?? 200,
  });
  return {
    app,
    store,
    runner,
    changes,
    limit,
    setView: (next: RunView | null) => {
      current = next;
    },
  };
}
