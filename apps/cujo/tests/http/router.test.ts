import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../../src/review/runner.service";
import { HOOK, INTERNAL, UI, build, req } from "./helpers";

describe("host dispatch", () => {
  it("serves healthz on both hosts", async () => {
    const { app } = build();
    for (const host of [UI, HOOK]) {
      const res = await app.fetch(req(host, "/healthz"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, service: "cujo" });
    }
  });

  it("answers 404 on an unknown host and on the wrong route per host", async () => {
    const { app } = build();
    expect((await app.fetch(req("other.test", "/healthz"))).status).toBe(404);
    expect((await app.fetch(req(HOOK, "/runs"))).status).toBe(404);
    expect((await app.fetch(req(UI, "/webhook", { method: "POST" }))).status).toBe(404);
    // Signature-gated ingress belongs on the webhook host, never behind Access.
    expect((await app.fetch(req(UI, "/discord/interactions", { method: "POST" }))).status).toBe(
      404,
    );
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

  it("requires an Access assertion on every UI route", async () => {
    const { app } = build();
    // The UI moved to apps/web, so this process serves no page: `/` is behind
    // the Access check like everything else, and 404s once past it.
    expect((await app.fetch(req(UI, "/"))).status).toBe(401);
    const page = await app.fetch(req(UI, "/", { headers: { "cf-access-jwt-assertion": "good" } }));
    expect(page.status).toBe(404);
    expect((await app.fetch(req(UI, "/runs"))).status).toBe(401);
    const ok = await app.fetch(
      req(UI, "/runs", { headers: { "cf-access-jwt-assertion": "good" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ runs: [] });
  });

  it("serves the API on the internal host, still behind Access", async () => {
    // apps/web reaches this process by its compose service name, because Node's
    // fetch always sends the target's own authority as Host. The Access check
    // is not relaxed for it, and the webhook stays unreachable.
    const { app } = build();
    expect((await app.fetch(req(INTERNAL, "/runs"))).status).toBe(401);
    const ok = await app.fetch(
      req(INTERNAL, "/runs", { headers: { "cf-access-jwt-assertion": "good" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ runs: [] });
    expect((await app.fetch(req(INTERNAL, "/webhook", { method: "POST" }))).status).toBe(404);
  });

  it("does not accept an internal host that was never configured", async () => {
    const { app } = build();
    expect((await app.fetch(req("cujo", "/runs"))).status).toBe(404);
  });

  /**
   * The mount point, which is the whole of decision 34's split. `/public/*`
   * has to answer with no assertion while its sibling `/runs` still refuses
   * one, on the same host and in the same process — and the webhook host must
   * not gain a read plane it never had.
   */
  describe("the public plane", () => {
    it("answers without an Access assertion, on both UI-side hosts", async () => {
      const { app } = build();
      for (const host of [UI, INTERNAL]) {
        const res = await app.fetch(req(host, "/public/runs"));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ runs: [] });
      }
    });

    it("leaves the gated routes gated", async () => {
      const { app } = build();
      expect((await app.fetch(req(UI, "/runs"))).status).toBe(401);
      expect((await app.fetch(req(UI, "/discord/channels"))).status).toBe(401);
    });

    it("is not served on the webhook host", async () => {
      const { app } = build();
      expect((await app.fetch(req(HOOK, "/public/runs"))).status).toBe(404);
    });

    it("has no write route, gated or otherwise", async () => {
      const { app } = build();
      const res = await app.fetch(
        req(UI, "/public/runs/r1/approve", {
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
    // Deleted with decision 48. A held finding is answered with `/cujo confirm`
    // on the pull request, where the principal is repo write and the trail is a
    // GitHub login — one gate, one place. A second one that still worked would
    // be the one nobody audits.
    const approve = vi.fn();
    const runner = { view: () => null, start: vi.fn(), approve } as unknown as Runner;
    const { app } = build({ runner });
    const headers = { "cf-access-jwt-assertion": "good", "content-type": "application/json" };
    const res = await app.fetch(
      req(UI, "/runs/r1/approve", {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "allow" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(approve).not.toHaveBeenCalled();
  });
});
