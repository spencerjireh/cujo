/**
 * The operator gate, while it accepts two credentials (decision 48).
 *
 * The token is where this plane is going; the Access assertion is what it has
 * today. Both work for one release so the token can be configured and the
 * Access application removed in either order — merging is the deploy, and a
 * gate that only accepts the credential nobody has issued yet locks the
 * operator out of their own board.
 */

import { createLogger } from "@cujo/log";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { operatorRoutes } from "../../../src/http/operator";
import type { Env } from "../../../src/http/operator/access";
import { requestLogger } from "../../../src/http/request-log";
import type { Runner } from "../../../src/review/runner.service";
import { Store } from "../../../src/store";

const TOKEN = "operator-token-value";

function build(over: { operatorToken?: string; access?: boolean } = {}) {
  const store = new Store(":memory:");
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) });
  const runner = {
    changes: { on: () => {}, off: () => {} },
    view: () => null,
  } as unknown as Runner;
  const app = new Hono<Env>();
  app.use("*", requestLogger(log, "delegated"));
  app.route(
    "/",
    operatorRoutes({
      runs: store.runs,
      notifications: store.notifications,
      runner,
      ...(over.operatorToken === undefined ? {} : { operatorToken: over.operatorToken }),
      verify: async (assertion) =>
        over.access !== false && assertion === "good"
          ? { operator: "op@example.com", reason: null }
          : { operator: null, reason: "no_assertion" as const },
    }),
  );
  const get = (headers: Record<string, string> = {}) => app.request("/runs", { headers });
  return { get, lines, reason: () => lines.find((l) => l.event === "access.denied")?.reason };
}

describe("the operator gate", () => {
  it("accepts the bearer token", async () => {
    const { get } = build({ operatorToken: TOKEN });
    expect((await get({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  it("accepts the scheme in any case, because HTTP says it is case-insensitive", async () => {
    // RFC 9110 §11.1. Refusing `bearer` would turn a correct token into a 401
    // for anyone whose client spells it that way.
    const { get } = build({ operatorToken: TOKEN });
    expect((await get({ authorization: `bearer ${TOKEN}` })).status).toBe(200);
    expect((await get({ authorization: `BEARER ${TOKEN}` })).status).toBe(200);
  });

  it("still accepts an Access assertion while both are configured", async () => {
    const { get } = build({ operatorToken: TOKEN });
    expect((await get({ "cf-access-jwt-assertion": "good" })).status).toBe(200);
  });

  it("refuses a wrong token rather than falling through to Access", async () => {
    // Whoever sent a token meant to use that gate. Falling through would let a
    // request carrying both a bad token and a good assertion in, which reads
    // as the token having worked.
    const { get, reason } = build({ operatorToken: TOKEN });
    const res = await get({
      authorization: "Bearer wrong-token-value!",
      "cf-access-jwt-assertion": "good",
    });
    expect(res.status).toBe(401);
    expect(reason()).toBe("bad_token");
  });

  it("ignores a bearer token when none is configured", async () => {
    // Empty means "not set up yet", not "accept anything".
    const { get } = build({ operatorToken: "" });
    expect((await get({ authorization: "Bearer anything" })).status).toBe(401);
    expect((await get({ "cf-access-jwt-assertion": "good" })).status).toBe(200);
  });

  it("refuses a request carrying neither", async () => {
    const { get } = build({ operatorToken: TOKEN });
    expect((await get()).status).toBe(401);
  });

  it("answers a bare 401, whichever check failed", async () => {
    // Naming the failing check tells a stranger how to pass it; the reason
    // goes to the log, where the operator debugging their own login reads it.
    const { get } = build({ operatorToken: TOKEN });
    const res = await get({ authorization: "Bearer wrong-token-value!" });
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("never echoes the token it refused", async () => {
    const { get, lines } = build({ operatorToken: TOKEN });
    await get({ authorization: "Bearer SENTINEL-not-the-token" });
    expect(JSON.stringify(lines)).not.toContain("SENTINEL");
  });

  it("works with the token alone once Access is gone", async () => {
    // The end state: no team domain, so `index.ts` builds no JWT verifier and
    // the gate refuses an assertion outright.
    const { get } = build({ operatorToken: TOKEN, access: false });
    expect((await get({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await get({ "cf-access-jwt-assertion": "good" })).status).toBe(401);
  });
});
