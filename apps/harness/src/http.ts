/**
 * The eight operations over HTTP, for one client on the compose network. No
 * auth, like github-mcp and sandbox-mcp: nothing outside the network can
 * reach this port, and there is no credential to present.
 */

import {
  CreateSessionBodySchema,
  CreateTurnBodySchema,
  McpServerManifestSchema,
  ModelProviderManifestSchema,
} from "@cujo/harness-contract";
import { type Logger, errorFields } from "@cujo/log";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { type Engine, HarnessError } from "./engine";
import type { Models } from "./model";
import type { Store } from "./store";

export interface AppDeps {
  engine: Engine;
  store: Store;
  models: Models;
  log: Logger;
}

/** How often a silent subscription sends a comment frame so proxies keep it open. */
const KEEPALIVE_MS = 15_000;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const { engine, store, models, log } = deps;

  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    const path = c.req.path;
    if (path === "/healthz" || path === "/readyz") return;
    log.info("http.request", {
      method: c.req.method,
      path,
      http_status: c.res.status,
      duration_ms: Date.now() - started,
    });
  });

  app.onError((error, c) => {
    if (error instanceof HarnessError) {
      return c.json({ ok: false, error: error.message, ...error.body }, error.status as 400);
    }
    log.error("http.failed", { path: c.req.path, ...errorFields(error) });
    return c.json({ ok: false, error: "internal error" }, 500);
  });

  const parse = async <S extends z.ZodTypeAny>(
    c: { req: { json(): Promise<unknown> } },
    schema: S,
  ): Promise<z.output<S>> => {
    const body = await c.req.json().catch(() => null);
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new HarnessError(400, "invalid body", { issues: result.error.issues });
    }
    return result.data as z.output<S>;
  };

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", (c) => c.json({ ok: true }));

  app.put("/settings/mcp-servers", async (c) => {
    const manifest = await parse(c, McpServerManifestSchema);
    store.putMcpServer(manifest);
    return c.json({ ok: true, name: manifest.name });
  });

  app.put("/settings/model-providers", async (c) => {
    const manifest = await parse(c, ModelProviderManifestSchema);
    store.putModelProvider(manifest);
    models.register(manifest);
    return c.json({ ok: true, name: manifest.name });
  });

  app.post("/sessions", async (c) => {
    const { spec } = await parse(c, CreateSessionBodySchema);
    return c.json({ id: engine.createSession(spec) }, 201);
  });

  app.post("/sessions/:id/turns", async (c) => {
    const { input } = await parse(c, CreateTurnBodySchema);
    return c.json({ id: await engine.createTurn(c.req.param("id"), input) }, 201);
  });

  app.post("/sessions/:id/cancel", async (c) => {
    await engine.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/sessions/:id/turns", (c) => c.json(engine.listTurns(c.req.param("id"))));

  app.get("/sessions/:id/events", (c) => {
    const after = Number(c.req.query("afterSeq") ?? 0);
    if (!Number.isInteger(after) || after < 0)
      throw new HarnessError(400, "afterSeq must be a non-negative integer");
    return c.json(engine.listEvents(c.req.param("id"), after));
  });

  app.get("/sessions/:id/turns/:turnId/subscribe", (c) => {
    const events = engine.subscribe(c.req.param("id"), c.req.param("turnId"));
    return streamSSE(c, async (stream) => {
      let seq = 0;
      const keepalive = setInterval(() => {
        void stream.writeSSE({ event: "keepalive", data: "" });
      }, KEEPALIVE_MS);
      try {
        for await (const event of events) {
          if (stream.aborted) break;
          await stream.writeSSE({ event: "event", id: String(seq++), data: JSON.stringify(event) });
        }
      } finally {
        clearInterval(keepalive);
      }
    });
  });

  return app;
}
