/**
 * The two probes, and the distinction between them (decision 37).
 *
 * The assertion that matters most here is the negative one: `/healthz` must not
 * learn anything. It is the compose healthcheck on a roughly sixty-second
 * budget, and `bootstrapUntilReady` backs off to a minute and retries forever,
 * so a `/healthz` that reported readiness would restart the container exactly
 * while the retry schedule is being patient — and `web` waits on `cujo` being
 * healthy, so it would take the UI down too.
 */

import { describe, expect, it } from "vitest";
import { HOOK, INTERNAL, UI, build, req } from "./helpers";

const LOCAL = "127.0.0.1";

describe("/healthz stays a liveness probe", () => {
  it("answers 200 with the same body even when the harness is not ready", async () => {
    const { app } = build({ isReady: () => false });
    for (const host of [UI, HOOK, LOCAL]) {
      const res = await app.fetch(req(host, "/healthz"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, service: "cujo" });
    }
  });
});

describe("/readyz", () => {
  it("answers on every host this process serves", async () => {
    const { app } = build();
    for (const host of [UI, HOOK, INTERNAL, LOCAL]) {
      expect((await app.fetch(req(host, "/readyz"))).status).toBe(200);
    }
  });

  it("widens no host boundary: an unknown Host still gets 404", async () => {
    const { app } = build();
    expect((await app.fetch(req("other.test", "/readyz"))).status).toBe(404);
  });

  it("reports ready when the harness has bootstrapped and the store answers", async () => {
    const { app } = build({ isReady: () => true });
    const res = await app.fetch(req(UI, "/readyz"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      service: "cujo",
      ready: true,
      checks: { harness: "ready", store: "ok" },
    });
    expect(typeof body.uptime_ms).toBe("number");
  });

  it("answers 503 while the harness is still bootstrapping", async () => {
    // The same flag the webhook itself gates on, so the two cannot disagree.
    const { app } = build({ isReady: () => false });
    const res = await app.fetch(req(UI, "/readyz"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      ready: false,
      checks: { harness: "bootstrapping", store: "ok" },
    });
  });

  it("answers 503 when the store cannot answer, whatever the harness says", async () => {
    // A delivery calls getSession, putSession and createRun synchronously, so
    // an unreachable store means no run can be claimed however healthy the
    // harness is. Closing the database is the cheapest real failure.
    const { app, store } = build({ isReady: () => true });
    store.close();
    const res = await app.fetch(req(UI, "/readyz"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ready: false,
      checks: { harness: "ready", store: "error" },
    });
  });

  it("reports how many log lines were lost", async () => {
    const { app } = build();
    const body = (await (await app.fetch(req(UI, "/readyz"))).json()) as {
      log_failures: { emit: number; stdout: number };
    };
    expect(typeof body.log_failures.emit).toBe("number");
    expect(typeof body.log_failures.stdout).toBe("number");
  });

  it("is not gated, because it names no repo and no person", async () => {
    // No assertion header on any of the requests above, and the body is
    // booleans and counts. The webhook's own 503 already announces the same
    // fact to anyone who cares to look.
    const { app } = build({ isReady: () => false });
    const body = JSON.stringify(await (await app.fetch(req(UI, "/readyz"))).json());
    expect(body).not.toContain("@");
  });
});

describe("neither probe is logged", () => {
  it("emits no http.request line for either, at any level", async () => {
    // They run every few seconds for the life of the container and would drown
    // the signal the vocabulary exists to create.
    const { app, logged } = build({ level: "debug" });
    await app.fetch(req(UI, "/healthz"));
    await app.fetch(req(HOOK, "/readyz"));
    expect(logged("http.request")).toEqual([]);
  });
});
