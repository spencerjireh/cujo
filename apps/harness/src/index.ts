/**
 * The harness (decision 123): sessions, turns and the approval gate over pi,
 * for `apps/cujo`. Replaces TrueForge one hole for another: same port, same
 * eight operations, no console, no database service.
 */

import { join } from "node:path";
import { createLogger, errorFields, parseLevel } from "@cujo/log";
import { serve } from "@hono/node-server";
import { Engine } from "./engine";
import { createApp } from "./http";
import { Models } from "./model";
import { Store, openDatabase } from "./store";

export { createApp } from "./http";
export { Engine } from "./engine";
export { Models } from "./model";
export { openDatabase, Store } from "./store";

const PORT = Number(process.env.PORT ?? 8790);
const DATA_DIR = process.env.HARNESS_DATA_DIR ?? "/data";

async function main(): Promise<void> {
  const log = createLogger({ service: "harness", level: parseLevel(process.env.CUJO_LOG_LEVEL) });
  const store = new Store(openDatabase(join(DATA_DIR, "harness.db")));
  const models = await Models.create();
  // Providers registered by an earlier process survive in the store; pi's
  // runtime is in memory and starts empty.
  for (const manifest of store.listModelProviders()) models.register(manifest);
  const engine = new Engine({ store, models, dataDir: DATA_DIR, log });
  engine.boot();
  const app = createApp({ engine, store, models, log });
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    log.info("service.started", { port: PORT });
  });
  // pi's provider refresh runs detached; a rejection there must not take the
  // process down, only the log.
  process.on("unhandledRejection", (error) => {
    log.error("service.fatal", { reason: "unhandled_rejection", ...errorFields(error) });
  });
  let stopping = false;
  const shutdown = (reason: "sigterm" | "sigint") => () => {
    if (stopping) return;
    stopping = true;
    log.info("service.stopping", { reason });
    server.close();
    void engine
      .close()
      .catch((error) => log.error("service.fatal", { reason: "close", ...errorFields(error) }))
      .finally(() => {
        store.close();
        process.exit(0);
      });
  };
  process.on("SIGTERM", shutdown("sigterm"));
  process.on("SIGINT", shutdown("sigint"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
