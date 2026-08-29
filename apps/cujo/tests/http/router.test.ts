import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../../src/review/runner.service";
import { HOOK, INTERNAL, build, req } from "./helpers";

describe("host dispatch", () => {
  it("serves healthz on both hosts", async () => {
    const { app } = build();
    for (const host of [INTERNAL, HOOK]) {
      const res = await app.fetch(req(host, "/healthz"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, service: "cujo" });
    }
  });

  it("answers 404 on an unknown host and on the wrong route per host", async () => {
    const { app } = build();
    expect((await app.fetch(req("other.test", "/healthz"))).status).toBe(404);
    expect((await app.fetch(req(HOOK, "/public/runs"))).status).toBe(404);
    expect((await app.fetch(req(INTERNAL, "/webhook", { method: "POST" }))).status).toBe(404);
    // Signature-gated ingress belongs on the webhook host and nowhere else.
    expect(
      (await app.fetch(req(INTERNAL, "/discord/interactions", { method: "POST" }))).status,
    ).toBe(404);
  });

  it("serves the Discord interactions route only when it is configured", async () => {
    const without = build();
    expect(
      (await without.app.fetch(req(HOOK, "/discord/interactions", { method: "POST" }))).status,
    ).toBe(404);

    const withCommands = build({ interactions: true });
    const res = await withCommands.app.fetch(
      req(HOOK, "/discord/interactions", { method: "POST", body: "{}" }),
    );
    // Present, and refusing an unsigned request.
    expect(res.status).toBe(401);
  });

  it("does not accept an internal host that was never configured", async () => {
    const { app } = build();
    expect((await app.fetch(req("cujo", "/public/runs"))).status).toBe(404);
  });

  /**
   * The invariant that replaced the gate (decision 52).
   *
   * There is no credential to present any more, so "not `/public`" can no
   * longer mean "behind the check" — it has to mean "not served". A 401 here
   * would be a route somebody could still reach with the right header; a 404
   * is the absence the deletion was supposed to produce. These paths are the
   * ones that used to answer 401, so they are the ones worth pinning.
   */
  describe("nothing but the read plane", () => {
    it("answers 404 to every path outside /public on the read host", async () => {
      const { app } = build();
      for (const path of [
        "/",
        "/runs",
        "/runs/r1",
        "/runs/r1/events",
        "/discord/channels",
        "/discord/authorizations",
        "/discord/guilds",
      ]) {
        const res = await app.fetch(req(INTERNAL, path));
        expect(res.status, path).toBe(404);
      }
    });

    it("does not accept a credential that used to work", async () => {
      // Both gates decision 49 accepted. Neither names a route now, and a
      // request carrying one must not be answered any differently from a
      // request carrying none — otherwise the gate is still there, inverted.
      const { app } = build();
      const bearer = await app.fetch(
        req(INTERNAL, "/runs", { headers: { authorization: "Bearer good" } }),
      );
      const assertion = await app.fetch(
        req(INTERNAL, "/runs", { headers: { "cf-access-jwt-assertion": "good" } }),
      );
      const bare = await app.fetch(req(INTERNAL, "/runs"));
      expect(bearer.status).toBe(404);
      expect(assertion.status).toBe(404);
      // Read once each: a Response body is single-use, so comparing against a
      // re-read `bare` would fail for a reason that is not the point.
      const bareBody = await bare.json();
      expect(await bearer.json()).toEqual(bareBody);
      expect(await assertion.json()).toEqual(bareBody);
    });
  });

  /**
   * The mount point. `/public/*` answers anonymously on the read host, and the
   * webhook host must not gain a read plane it never had.
   */
  describe("the public plane", () => {
    it("answers without any credential on the read host", async () => {
      const { app } = build();
      const res = await app.fetch(req(INTERNAL, "/public/runs"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ runs: [] });
    });

    it("is not served on the webhook host", async () => {
      const { app } = build();
      expect((await app.fetch(req(HOOK, "/public/runs"))).status).toBe(404);
    });

    it("has no write route", async () => {
      const { app } = build();
      const res = await app.fetch(
        req(INTERNAL, "/public/runs/r1/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "allow" }),
        }),
      );
      expect(res.status).toBe(404);
    });
  });
});

describe("the approve route, which is gone", () => {
  it("serves no approve route on any plane", async () => {
    // Deleted with decision 49. A held finding is answered with `/cujo confirm`
    // on the pull request, where the principal is repo write and the trail is a
    // GitHub login — one gate, one place. A second one that still worked would
    // be the one nobody audits.
    const approve = vi.fn();
    const runner = { view: () => null, start: vi.fn(), approve } as unknown as Runner;
    const { app } = build({ runner });
    for (const host of [INTERNAL, HOOK]) {
      const res = await app.fetch(
        req(host, "/runs/r1/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "allow" }),
        }),
      );
      expect(res.status, host).toBe(404);
    }
    expect(approve).not.toHaveBeenCalled();
  });
});
