import { Hono } from "hono";
import { type InteractionDeps, interactionRoutes } from "./ingress/discord-interactions";
import { type WebhookDeps, webhookRoutes } from "./ingress/github-webhook";
import { type OperatorDeps, operatorRoutes } from "./operator";
import { type PublicDeps, publicRoutes } from "./public";

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
}

function hostOf(header: string | undefined): string {
  return (header ?? "").split(":")[0]?.toLowerCase() ?? "";
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
export function createApp(options: AppOptions): Hono {
  // The gated plane is its own instance and is delegated to, rather than being
  // layered under the same router as the public routes. operatorRoutes applies
  // its Access check with `app.use("*")`, which would otherwise also match
  // /public/* and leave the split resting on Hono's handler ordering — true
  // today, invisible to a reviewer, and one `await next()` from being false.
  const gated = new Hono();
  gated.route("/", operatorRoutes(options.api));

  const ui = new Hono();
  ui.get("/healthz", (c) => c.json({ ok: true, service: "cujo" }));
  // The webhook is never reachable on the UI host, not even as a 401. The same
  // goes for the Discord interactions endpoint: both are signature-gated
  // ingress, and neither belongs behind Access.
  ui.all("/webhook", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.all("/discord/interactions", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.route("/public", publicRoutes(options.public).app);
  // Everything else on this host is behind the Access check.
  ui.all("*", (c) => gated.fetch(c.req.raw));

  const webhook = new Hono();
  webhook.get("/healthz", (c) => c.json({ ok: true, service: "cujo" }));
  webhook.route("/", webhookRoutes(options.webhook));
  if (options.interactions) webhook.route("/", interactionRoutes(options.interactions));

  const app = new Hono();
  app.all("*", (c) => {
    const host = hostOf(c.req.header("host"));
    if (host === options.uiHost) return ui.fetch(c.req.raw);
    if (options.internalHost && host === options.internalHost) return ui.fetch(c.req.raw);
    if (host === options.webhookHost) return webhook.fetch(c.req.raw);
    // The compose healthcheck hits 127.0.0.1 directly.
    if (host === "127.0.0.1" || host === "localhost") {
      if (new URL(c.req.url).pathname === "/healthz") {
        return c.json({ ok: true, service: "cujo" });
      }
    }
    return c.json({ ok: false, error: "unknown host" }, 404);
  });
  return app;
}
