import { Hono } from "hono";
import { type ApiDeps, apiRoutes } from "./api";
import { type WebhookDeps, webhookRoutes } from "./webhook";

export interface AppOptions {
  uiHost: string;
  webhookHost: string;
  api: ApiDeps;
  webhook: WebhookDeps;
}

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cujo</title>
<style>body{font:16px/1.5 system-ui;margin:3rem auto;max-width:40rem;padding:0 1rem;color:#1c1917}
code{background:#f5f5f4;padding:.1em .3em;border-radius:3px}</style></head>
<body><h1>Cujo</h1>
<p>Execution-backed pull request review. The operator UI lands in the next release;
the API is live: <code>GET /runs</code>, <code>GET /runs/:id</code>,
<code>GET /runs/:id/events</code>, <code>POST /runs/:id/approve</code>.</p>
</body></html>`;

function hostOf(header: string | undefined): string {
  return (header ?? "").split(":")[0]?.toLowerCase() ?? "";
}

/**
 * One process, two hostnames (Contract 6). The split is enforced here, not
 * only at the edge: the webhook host never serves /runs and the UI host never
 * serves /webhook. Any other Host gets 404.
 */
export function createApp(options: AppOptions): Hono {
  const ui = new Hono();
  ui.get("/healthz", (c) => c.json({ ok: true, service: "cujo" }));
  ui.get("/", (c) => c.html(PLACEHOLDER));
  // The webhook is never reachable on the UI host, not even as a 401.
  ui.all("/webhook", (c) => c.json({ ok: false, error: "not found" }, 404));
  ui.route("/", apiRoutes(options.api));

  const webhook = new Hono();
  webhook.get("/healthz", (c) => c.json({ ok: true, service: "cujo" }));
  webhook.route("/", webhookRoutes(options.webhook));

  const app = new Hono();
  app.all("*", (c) => {
    const host = hostOf(c.req.header("host"));
    if (host === options.uiHost) return ui.fetch(c.req.raw);
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
