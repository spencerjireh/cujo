import { type Logger, logFailureCount } from "@cujo/log";
import { Hono } from "hono";
import { type InteractionDeps, interactionRoutes } from "./ingress/discord-interactions";
import { type WebhookDeps, webhookRoutes } from "./ingress/github-webhook";
import { type OperatorDeps, operatorRoutes } from "./operator";
import { type PublicDeps, publicRoutes } from "./public";
import type { StreamLimit } from "./public/stream-limit";
import { type Plane, type RequestEnv, requestLogger, withRay } from "./request-log";

export interface AppOptions {
  uiHost: string;
  webhookHost: string;
  /**
   * The compose service name `apps/web` addresses this process by. Node's fetch
   * always sends the target's own authority as `Host`, so the operator UI's
   * proxy cannot present the public hostname; accepting the internal name is
   * what lets the API routes stay reachable behind it. The Access check still
   * applies to every one of those routes.
   */
  internalHost?: string;
  api: OperatorDeps;
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
  const storeOk = options.api.runs.ping();
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
 * here, not only at the edge: the webhook host never serves /runs and the UI
 * host never serves /webhook. Any other Host gets 404.
 *
 * The UI itself is `apps/web`; this process serves only the JSON API, which
 * that app reaches over the compose network under `internalHost`. Because that
 * hop rewrites `Host` to the target's own authority, this process never sees
 * the public hostname, so the public plane is a path and not a fourth host
 * (decision 34).
 */
export function createApp(options: AppOptions): Hono<RequestEnv> {
  // The gated plane is its own instance and is delegated to, rather than being
  // layered under the same router as the public routes. operatorRoutes applies
  // its Access check with `app.use("*")`, which would otherwise also match
  // /public/* and leave the split resting on Hono's handler ordering — true
  // today, invisible to a reviewer, and one `await next()` from being false.
  // Every instance the outer router delegates to re-derives the ray from the
  // request, because `fetch` on a Hono instance builds a fresh context and
  // nothing set on the outer one survives the hop. They agree because the ray
  // travels on the request, not because they each guess the same way.
  const gated = new Hono<RequestEnv>();
  gated.use("*", requestLogger(options.log, "delegated"));
  gated.route("/", operatorRoutes(options.api));

  const publicPlane = publicRoutes(options.public);

  const ui = new Hono<RequestEnv>();
  ui.use("*", requestLogger(options.log, "delegated"));
  ui.get("/healthz", (c) => c.json(HEALTHZ));
  ui.get("/readyz", (c) => {
    const { body, status } = readyz(options, publicPlane.limit);
    return c.json(body, status);
  });
  // The webhook is never reachable on the UI host, not even as a 401. The same
  // goes for the Discord interactions endpoint: both are signature-gated
  // ingress, and neither belongs behind Access.
  ui.all("/webhook", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.all("/discord/interactions", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.route("/public", publicPlane.app);
  // Everything else on this host is behind the Access check. The raw request
  // already carries the ray header, so the gated instance re-derives the same
  // one rather than inventing a second.
  ui.all("*", (c) => gated.fetch(c.req.raw));

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
      if (host === options.uiHost || (options.internalHost && host === options.internalHost)) {
        // Exactly the mount, not every path that starts with those characters:
        // `/publicity` falls through to the gated router, so calling it public
        // would put the wrong trust boundary on the line.
        plane = path === "/public" || path.startsWith("/public/") ? "public" : "operator";
        probe = PROBE_PATHS.has(path);
        return ui.fetch(forwarded);
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
