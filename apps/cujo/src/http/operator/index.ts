/**
 * The operator plane: everything behind Cloudflare Access.
 *
 * The gate is applied here, once, and the two route groups are mounted under
 * it. Each group re-declaring its own `app.use("*", verify)` would run the
 * JWT verification twice per request and no test would notice, so the gate
 * stays in exactly one place and the groups assume it.
 */

import { Hono } from "hono";
import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import type { Runner } from "../../review/runner.service";
import type { NotificationStore, RunStore } from "../../store";
import type { AccessVerifier, Env } from "./access";
import { discordAdminRoutes } from "./discord-admin";
import { runRoutes } from "./runs";

export interface OperatorDeps {
  runs: RunStore;
  notifications: NotificationStore;
  runner: Runner;
  verify: AccessVerifier;
  /** Absent when DISCORD_BOT_TOKEN is unset; the Discord routes then 503. */
  discord?: DiscordClient;
  /** Used to check a repo is one the Cujo App can actually review. */
  github?: GitHubReader;
}

/** Contract 6 operator API. Every route requires a verified Access assertion. */
export function operatorRoutes(deps: OperatorDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const email = await deps.verify(c.req.header("cf-access-jwt-assertion"));
    if (!email) return c.json({ ok: false, error: "unauthorized" }, 401);
    c.set("email", email);
    await next();
  });

  app.route("/", runRoutes({ runs: deps.runs, runner: deps.runner }));
  app.route(
    "/",
    discordAdminRoutes({
      notifications: deps.notifications,
      ...(deps.discord ? { discord: deps.discord } : {}),
      ...(deps.github ? { github: deps.github } : {}),
    }),
  );

  return app;
}
