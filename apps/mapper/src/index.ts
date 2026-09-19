/**
 * The mapper: a repository's shape, read once and asked about many times
 * (decision 172).
 *
 * `apps/cujo` streams in a pull request's base and head trees, this service
 * turns them into a git repository and indexes it with
 * `codebase-memory-mcp`, and `/slice` answers what a diff reaches. It holds
 * no token, no clone URL and no hostname: only the bytes of code that is
 * already public to the reviewer, and the JSON it derives from them.
 */

import { createLogger, errorFields } from "@cujo/log";
import { Engine } from "./engine";
import { TreeStore } from "./ingest";
import { createBridge } from "./mcp";
import { createApp } from "./server";
import { DiskStore } from "./store";

export { createApp } from "./server";
export { Engine } from "./engine";
export { TreeStore } from "./ingest";
export { DiskStore } from "./store";
export { buildSlice, usersOf } from "./slice";

const PORT = Number(process.env.PORT ?? 8084);
const DIR = process.env.CUJO_MAPPER_DIR ?? "/data/repos";
const CACHE_DIR = process.env.CUJO_MAPPER_CACHE_DIR ?? "/data/graphs";
const BIN = process.env.CUJO_MAPPER_BIN ?? "/usr/local/bin/codebase-memory-mcp";
/** One tree's ceiling. The sandbox's staging door uses the same number. */
const MAX_TREE_BYTES = Number(process.env.CUJO_MAPPER_TREE_BYTES ?? 256 * 1024 * 1024);
const MAX_DISK_BYTES = Number(process.env.CUJO_MAPPER_DISK_MB ?? 8192) * 1024 * 1024;
/** Indexing this repository took six seconds; a big one is allowed far more. */
const ENGINE_TIMEOUT_MS = Number(process.env.CUJO_MAPPER_TIMEOUT_MS ?? 10 * 60_000);

function parseLevel(value: string | undefined): "debug" | "info" | "warn" | "error" | undefined {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const level = parseLevel(process.env.CUJO_LOG_LEVEL);
  const log = createLogger({ service: "mapper", ...(level ? { level } : {}) });
  const engine = new Engine({
    bin: BIN,
    cacheDir: CACHE_DIR,
    allowedRoot: DIR,
    timeoutMs: ENGINE_TIMEOUT_MS,
    log,
  });
  const trees = new TreeStore({ dir: DIR, maxBytes: MAX_TREE_BYTES, log });
  const disk = new DiskStore({ dir: DIR, maxBytes: MAX_DISK_BYTES, log });
  // Off unless a composition asks. Nothing in this repository asks yet.
  const mcp = process.env.CUJO_MAPPER_MCP
    ? createBridge({ bin: BIN, cacheDir: CACHE_DIR, allowedRoot: DIR, log })
    : undefined;
  // The engine runs, or this service is a set of routes that cannot answer.
  // A bundle that loads proves nothing about a C binary beside it: the image
  // once shipped an engine built against a newer glibc than the runtime had,
  // and every check passed until the first index. So it is exercised at boot
  // and the failure is loud and immediate.
  const ready = engine
    .version()
    .then((version) => {
      log.info("service.started", {
        port: PORT,
        reason: version,
        enabled: mcp !== undefined,
        limit: MAX_DISK_BYTES,
      });
    })
    .catch((error) => {
      log.error("service.fatal", { reason: "engine", ...errorFields(error) });
      process.exit(1);
    });
  createApp({ engine, trees, disk, dir: DIR, log, ready, ...(mcp ? { mcp } : {}) }).listen(PORT);
}
