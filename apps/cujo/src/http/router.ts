import { Hono } from "hono";
import { type InteractionDeps, interactionRoutes } from "./ingress/discord-interactions";
import { type WebhookDeps, webhookRoutes } from "./ingress/github-webhook";
import { type OperatorDeps, operatorRoutes } from "./operator";

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
  webhook: WebhookDeps;
  /** Absent when the Discord slash commands are not configured. */
  interactions?: InteractionDeps;
}

function hostOf(header: string | undefined): string {
  return (header ?? "").split(":")[0]?.toLowerCase() ?? "";
}

/**
 * One process, two hostnames (Contract 6). The split is enforced here, not
 * only at the edge: the webhook host never serves /runs and the UI host never
 * serves /webhook. Any other Host gets 404.
 *
 * The UI itself is `apps/web`; this process serves only the JSON API, which
 * that app reaches over the compose network under `internalHost`.
 */
export function createApp(options: AppOptions): Hono {
  const ui = new Hono();
  ui.get("/healthz", (c) => c.json({ ok: true, service: "cujo" }));
  // The webhook is never reachable on the UI host, not even as a 401. The same
  // goes for the Discord interactions endpoint: both are signature-gated
  // ingress, and neither belongs behind Access.
  ui.all("/webhook", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.all("/discord/interactions", (c) => c.json({ ok: false, error: "not found" }, 404));
  // Every UI-host route sits behind the Access check inside operatorRoutes.
  ui.route("/", operatorRoutes(options.api));

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
