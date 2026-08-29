import { type Logger, logFailureCount } from "@cujo/log";
import { Hono } from "hono";
import { type InteractionDeps, interactionRoutes } from "./ingress/discord-interactions";
import { type WebhookDeps, webhookRoutes } from "./ingress/github-webhook";
import { type PublicDeps, publicRoutes } from "./public";
import type { StreamLimit } from "./public/stream-limit";
import { type Plane, type RequestEnv, requestLogger, withRay } from "./request-log";

export interface AppOptions {
  webhookHost: string;
  /**
   * The compose service name `apps/web` addresses this process by, and the only
   * name the read plane answers on. Node's fetch always sends the target's own
   * authority as `Host`, so the UI's proxy cannot present a published hostname;
   * accepting the internal name is what lets the read routes stay reachable
   * behind it (decision 54).
   */
  internalHost: string;
  /** The anonymous read-only plane under `/public` (decision 34). */
  public: PublicDeps;
  webhook: WebhookDeps;
  /** Absent when the Discord slash commands are not configured. */
  interactions?: InteractionDeps;
  /** The process logger. Every request gets a child of it, bound to its ray. */
  log: Logger;
}

function hostOf(header: string | undefined): string {
  return (header ?? "").split(":")[0]?.toLowerCase() ?? "";
}

/** Liveness, and nothing else. See `readyz` below for why it stays this way. */
const HEALTHZ = { ok: true, service: "cujo" } as const;

/** Neither probe is logged: they run every few seconds, forever. */
const PROBE_PATHS = new Set(["/healthz", "/readyz"]);

/**
 * Readiness, which `/healthz` deliberately is not (decision 37).
 *
 * `/healthz` is the compose healthcheck on a roughly sixty-second budget, while
 * `bootstrapUntilReady` backs off to a minute and retries forever — so
 * reporting bootstrap state there would restart the container exactly when the
 * retry schedule is being patient, and `web` depends on `cujo` being healthy,
 * so it would take the UI down too.
 *
 * The harness flag is the same one the webhook gates on rather than a second
 * probe of the same thing, so the two cannot disagree. The store is in the
 * disjunction and not merely in the body: a delivery calls `getSession`,
 * `putSession` and `createRun` synchronously, so an unreachable store means no
 * run can be claimed however healthy the harness is.
 */
function readyz(options: AppOptions, limit: StreamLimit) {
  const harnessReady = options.webhook.isReady?.() ?? true;
  const storeOk = options.public.runs.ping();
  const ready = harnessReady && storeOk;
  return {
    body: {
      ok: ready,
      service: "cujo",
      ready,
      checks: {
        harness: harnessReady ? "ready" : "bootstrapping",
        store: storeOk ? "ok" : "error",
      },
      // Contract 6. `active()` existed and was reachable from nothing until
      // now: `publicRoutes` returns it and `router.ts` used only `.app`.
      public_streams: { active: limit.active(), limit: options.public.streamLimit },
      // Lines the logger could not write. A service quietly dropping its own
      // audit trail should be visible somewhere, and this is that somewhere.
      log_failures: logFailureCount(),
      uptime_ms: Math.round(process.uptime() * 1000),
    },
    status: ready ? (200 as const) : (503 as const),
  };
}

/**
 * One process, two hostnames and two planes (Contract 6). The split is enforced
 * here, not only at the edge: the webhook host never serves /public and the
 * read host never serves /webhook. Any other Host gets 404.
 *
 * Neither plane has a credential. The ingress host takes signed requests and
 * nothing else; the read host serves the anonymous board and nothing else.
 * There is no third, authenticated plane — decision 54 deleted it, so a route
 * that is not on this list is not reachable at all rather than reachable to
 * whoever holds a token.
 *
 * The UI itself is `apps/web`; this process serves only the JSON API, which
 * that app reaches over the compose network under `internalHost`. Because that
 * hop rewrites `Host` to the target's own authority, this process never sees a
 * published hostname, so the read plane is a path on the internal name rather
 * than a host of its own (decision 34, decision 54).
 */
export function createApp(options: AppOptions): Hono<RequestEnv> {
  // Every instance the outer router delegates to re-derives the ray from the
  // request, because `fetch` on a Hono instance builds a fresh context and
  // nothing set on the outer one survives the hop. They agree because the ray
  // travels on the request, not because they each guess the same way.
  const publicPlane = publicRoutes(options.public);

  // Named for what it serves, not for who reads it: `apps/web` is the UI, and
  // this is the read plane it calls.
  const read = new Hono<RequestEnv>();
  read.use("*", requestLogger(options.log, "delegated"));
  read.get("/healthz", (c) => c.json(HEALTHZ));
  read.get("/readyz", (c) => {
    const { body, status } = readyz(options, publicPlane.limit);
    return c.json(body, status);
  });
  // Spelled out rather than left to the catch-all below, because these two are
  // the paths somebody will try here: signature-gated ingress belongs on the
  // webhook host and is not reachable from this one at all.
  read.all("/webhook", (c) => c.json({ ok: false, error: "not found" }, 404));
  read.all("/discord/interactions", (c) => c.json({ ok: false, error: "not found" }, 404));
  read.route("/public", publicPlane.app);
  // Everything else on this host is 404. That is the whole rule now: there is
  // no credential to present and no plane behind this line, so a path that is
  // not `/public` is not served rather than served to whoever authenticates
  // (decision 54).
  read.all("*", (c) => c.json({ ok: false, error: "not found" }, 404));

  const webhook = new Hono<RequestEnv>();
  webhook.use("*", requestLogger(options.log, "delegated"));
  webhook.get("/healthz", (c) => c.json(HEALTHZ));
  webhook.get("/readyz", (c) => {
    const { body, status } = readyz(options, publicPlane.limit);
    return c.json(body, status);
  });
  webhook.route("/", webhookRoutes(options.webhook));
  if (options.interactions) webhook.route("/", interactionRoutes(options.interactions));

  const app = new Hono<RequestEnv>();
  // Above the host split, so every request has a ray — including one for an
  // unknown Host, which is exactly the request somebody will be trying to
  // explain.
  app.use("*", requestLogger(options.log, "edge"));
  app.all("*", async (c) => {
    const host = hostOf(c.req.header("host"));
    const path = new URL(c.req.url).pathname;
    const started = Date.now();
    const ray = c.get("ray");
    let plane: Plane = "unknown";
    // Only a probe this service actually answered. Suppressing by path alone
    // would hide an unknown host asking for /healthz, which is a 404 and not a
    // probe — and is exactly the request the unknown-host rule exists for.
    let probe = false;

    const answer = async (): Promise<Response> => {
      const forwarded = withRay(c.req.raw, ray);
      if (host === options.internalHost) {
        // Exactly the mount, not every path that starts with those characters:
        // `/publicity` is a 404 and not the board, so calling it public would
        // file the wrong path under the plane that serves run data.
        plane = path === "/public" || path.startsWith("/public/") ? "public" : "unknown";
        probe = PROBE_PATHS.has(path);
        return read.fetch(forwarded);
      }
      if (host === options.webhookHost) {
        plane = "ingress";
        probe = PROBE_PATHS.has(path);
        return webhook.fetch(forwarded);
      }
      // The compose healthcheck hits 127.0.0.1 directly.
      if (host === "127.0.0.1" || host === "localhost") {
        if (path === "/healthz") {
          probe = true;
          return c.json(HEALTHZ);
        }
        if (path === "/readyz") {
          probe = true;
          const { body, status } = readyz(options, publicPlane.limit);
          return c.json(body, status);
        }
      }
      return c.json({ ok: false, error: "unknown host" }, 404);
    };

    const response = await answer();
    if (!probe) {
      c.get("log").info("http.request", {
        plane,
        method: c.req.method,
        path,
        http_status: response.status,
        duration_ms: Date.now() - started,
      });
    }
    return response;
  });
  return app;
}
