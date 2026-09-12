/**
 * The sandbox MCP server: the door around the harness's `type: "daytona"`
 * literal (decision 113).
 *
 * `CUJO_SANDBOX_RUNTIME` picks an implementation. `local` is a container on this
 * host with egress enforced by a gateway outside it; `daytona` is the old vendor
 * kept so the move is reversible on one variable. Nothing else in the process
 * knows which is running.
 */

import { createLogger, errorFields, parseLevel } from "@cujo/log";
import { dockerCli } from "./docker";
import { buildImages } from "./images";
import type { SandboxRuntime } from "./runtime";
import { DaytonaRuntime } from "./runtimes/daytona";
import { LocalRuntime } from "./runtimes/local";
import { createApp } from "./server";

export { createApp } from "./server";
export { LocalRuntime } from "./runtimes/local";
export { DaytonaRuntime } from "./runtimes/daytona";

const PORT = Number(process.env.PORT ?? 8082);
/**
 * Where this image carries the two build contexts (`apps/sandbox-mcp/Dockerfile`
 * copies them here). Empty means the images are somebody else's problem, which
 * is what a developer with both already built wants.
 */
const IMAGES_DIR = process.env.CUJO_SANDBOX_IMAGES_DIR ?? "/app/images";
/** How often expired sandboxes are reaped. Cheap, and a leak here is containers. */
const REAP_INTERVAL_MS = 5 * 60 * 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function buildRuntime(log = createLogger({ service: "sandbox-mcp" })): SandboxRuntime {
  const choice = process.env.CUJO_SANDBOX_RUNTIME ?? "local";
  if (choice === "daytona") {
    return new DaytonaRuntime({
      apiUrl: requireEnv("DAYTONA_API_URL"),
      apiKey: requireEnv("DAYTONA_API_KEY"),
      image: process.env.CUJO_SANDBOX_IMAGE,
      log,
    });
  }
  if (choice !== "local") {
    // Named rather than defaulted. A typo that silently ran a different
    // isolation model is the one failure this service must not have.
    throw new Error(`CUJO_SANDBOX_RUNTIME must be "local" or "daytona", not ${choice}`);
  }
  return new LocalRuntime({
    image: requireEnv("CUJO_SANDBOX_IMAGE"),
    gatewayImage: requireEnv("CUJO_SANDBOX_GATEWAY_IMAGE"),
    // Optional, and absent means Docker's default runtime with a warning on
    // every create. A host that has not had gVisor installed still runs reviews.
    containerRuntime: process.env.CUJO_SANDBOX_CONTAINER_RUNTIME,
    egressNetwork: process.env.CUJO_SANDBOX_EGRESS_NETWORK,
    maxLifetimeMs: process.env.CUJO_SANDBOX_MAX_LIFETIME_MS
      ? Number(process.env.CUJO_SANDBOX_MAX_LIFETIME_MS)
      : undefined,
    log,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger({
    service: "sandbox-mcp",
    level: parseLevel(process.env.CUJO_LOG_LEVEL),
  });
  const runtime = buildRuntime(log);
  // The local runtime's images are built here, at boot, from contexts this
  // image carries (decision 118). Nothing else in the deployment builds them:
  // they are started with `docker run` per sandbox, not as compose services,
  // so `up --build` never sees them. The server listens meanwhile and answers
  // 503, so the healthcheck reports a boot in progress rather than a dead port;
  // a build that fails ends the process, because a sandbox service that cannot
  // provision is one the deploy must not call healthy.
  const ready =
    runtime instanceof LocalRuntime && IMAGES_DIR !== ""
      ? buildImages(
          [
            { tag: requireEnv("CUJO_SANDBOX_IMAGE"), context: `${IMAGES_DIR}/sandbox` },
            { tag: requireEnv("CUJO_SANDBOX_GATEWAY_IMAGE"), context: `${IMAGES_DIR}/gateway` },
          ],
          { docker: dockerCli(), log },
        )
      : undefined;
  createApp({ runtime, log, ready }).listen(PORT, () => {
    log.info("service.started", { port: PORT, reason: runtime.name, ready: ready === undefined });
  });
  ready?.catch((error) => {
    log.error("sandbox.image.build.failed", errorFields(error));
    process.exit(1);
  });
  if (runtime instanceof LocalRuntime) {
    // A sandbox whose caller went away still holds a network and two containers,
    // and this process is the only thing that knows they belong together.
    const timer = setInterval(() => {
      void runtime
        .reapExpired()
        .catch((error) => log.warn("sandbox.reap.failed", errorFields(error)));
    }, REAP_INTERVAL_MS);
    timer.unref();
  }
}
