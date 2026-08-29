/**
 * The operator plane: everything behind the operator gate.
 *
 * The gate is applied here, once, and the two route groups are mounted under
 * it. Each group re-declaring its own `app.use("*", verify)` would run the
 * verification twice per request and no test would notice, so the gate stays
 * in exactly one place and the groups assume it.
 *
 * **Two credentials for one release** (decision 48). A bearer token is what
 * this plane is moving to; a Cloudflare Access assertion is what it has today.
 * Both are accepted here so the token can be configured and the Access
 * application removed in either order, because merging is the deploy and a
 * gate that only accepts the credential nobody has issued yet locks the
 * operator out of their own board (decision 35).
 */

import { Hono } from "hono";
import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import type { Runner } from "../../review/runner.service";
import type { NotificationStore, RunStore } from "../../store";
import { type AccessResult, type AccessVerifier, type Env, verifyOperatorToken } from "./access";
import { discordAdminRoutes } from "./discord-admin";
import { runRoutes } from "./runs";

export interface OperatorDeps {
  runs: RunStore;
  notifications: NotificationStore;
  runner: Runner;
  verify: AccessVerifier;
  /**
   * The shared operator token, or "" when none is configured. Empty disables
   * the bearer path entirely rather than accepting an empty credential, which
   * is the difference between "not set up yet" and "open".
   */
  operatorToken?: string;
  /** Absent when DISCORD_BOT_TOKEN is unset; the Discord routes then 503. */
  discord?: DiscordClient;
  /** Used to check a repo is one the Cujo App can actually review. */
  github?: GitHubReader;
}

/**
 * Either credential, the bearer token first.
 *
 * Token first because it is where this is going and because it is the cheap
 * check — no network, no key set. A request carrying neither is refused with
 * the reason for whichever gate is configured, so an operator reading the log
 * sees the one they were actually meant to pass.
 */
async function authorize(deps: OperatorDeps, headers: Headers): Promise<AccessResult> {
  const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (deps.operatorToken) {
    const result = verifyOperatorToken(deps.operatorToken, bearer);
    // A presented token that is wrong is a refusal, not a reason to fall
    // through: whoever sent it meant to use this gate.
    if (result.operator || bearer) return result;
  }
  return deps.verify(headers.get("cf-access-jwt-assertion") ?? undefined);
}

/** Contract 6 operator API. Every route requires a verified operator. */
export function operatorRoutes(deps: OperatorDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const { operator, reason } = await authorize(deps, c.req.raw.headers);
    if (!operator) {
      // The caller still gets a bare 401 — naming the failing check tells a
      // stranger how to pass it. The reason goes to the log, where the
      // operator debugging their own login can read it.
      //
      // Never the assertion itself, and never an email lifted from it: on a
      // failed verification nothing in that token has been checked, so every
      // claim in it is attacker-supplied.
      c.get("log").warn("access.denied", {
        path: new URL(c.req.url).pathname,
        reason: reason ?? "malformed",
      });
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    c.set("operator", operator);
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
