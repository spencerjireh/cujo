/**
 * The public plane: the run board as an anonymous visitor sees it (decision 34).
 *
 * No Access check, by construction rather than by omission — `router.ts` mounts
 * this group on its own Hono instance, beside the gated one rather than under
 * it, so the operator gate's `app.use("*")` cannot compose with these handlers.
 * There is no verifier in `PublicDeps` and no route here writes anything.
 *
 * Two conditions guard every response: the run must exist, and its repo must
 * have been public. Both are answered by `visible()` so there is one place to
 * get them wrong, and the list filters in SQL rather than here.
 */

import { Hono } from "hono";
import type { RunView, Runner } from "../../review/runner.service";
import type { RunStore } from "../../store";
import type { RequestEnv } from "../request-log";
import { streamRun } from "../run-stream";
import { serializePublicRun, serializePublicSummary } from "./serialize";
import { type StreamLimit, createStreamLimit } from "./stream-limit";

export interface PublicDeps {
  runs: RunStore;
  runner: Runner;
  /** Concurrent public streams allowed at once. */
  streamLimit: number;
}

export function publicRoutes(deps: PublicDeps): { app: Hono<RequestEnv>; limit: StreamLimit } {
  const app = new Hono<RequestEnv>();
  const limit = createStreamLimit(deps.streamLimit);

  /**
   * A run nobody may see is 404, not 403: the public plane does not confirm
   * that a private repo has runs at all.
   */
  const visible = (id: string): RunView | null => {
    const view = deps.runner.view(id);
    return view?.run.isPublic ? view : null;
  };

  app.get("/runs", (c) => {
    return c.json({ runs: deps.runs.listPublicRuns().map(serializePublicSummary) });
  });

  app.get("/runs/:id", (c) => {
    const view = visible(c.req.param("id"));
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return c.json(serializePublicRun(view));
  });

  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const view = visible(id);
    if (!view) return c.json({ ok: false, error: "not found" }, 404);
    return streamRun(c, id, view, {
      runner: deps.runner,
      visible,
      admits: (v) => v.run.isPublic,
      limit,
      limitSize: deps.streamLimit,
      plane: "public",
    });
  });

  // The public surface is exactly the three routes above. Without this the
  // fall-through would reach the gated plane and answer 401, so the failure
  // direction is closed either way; this makes it enumerable.
  app.all("*", (c) => c.json({ ok: false, error: "not found" }, 404));

  return { app, limit };
}
