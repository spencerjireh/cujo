/**
 * The correlation id and the one line per request (decision 37).
 *
 * The middleware sits above the host split, so the properties asserted here
 * hold for every plane — including the unknown-host 404, which is exactly the
 * request somebody will be trying to explain.
 */

import { describe, expect, it } from "vitest";
import { GENERATED_RAY_PREFIX, rayFrom } from "../../src/http/request-log";
import { HOOK, INTERNAL, build, req } from "./helpers";

describe("rayFrom", () => {
  it("takes Cloudflare's id when the edge sent one", () => {
    expect(rayFrom("8f2a1c3d4e5f6a7b-LHR")).toBe("8f2a1c3d4e5f6a7b-LHR");
  });

  it("invents one otherwise, marked so nobody mistakes it for an edge id", () => {
    // Locally there is no Cloudflare in front, and a generated id that looked
    // like a real ray would be worse than no id at all.
    for (const absent of [undefined, "", "   "]) {
      expect(rayFrom(absent).startsWith(GENERATED_RAY_PREFIX)).toBe(true);
    }
  });

  it("invents a different one each time", () => {
    expect(rayFrom(undefined)).not.toBe(rayFrom(undefined));
  });
});

describe("one line per request", () => {
  it("carries the plane, method, path, status and duration", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs"));
    const [line] = logged("http.request");
    expect(line).toMatchObject({
      event: "http.request",
      plane: "public",
      method: "GET",
      path: "/public/runs",
      http_status: 200,
    });
    expect(typeof line?.duration_ms).toBe("number");
  });

  it("names the plane that answered, not the host that was asked", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs"));
    await app.fetch(req(HOOK, "/webhook", { method: "POST" }));
    // Not `/public`, so not the read plane — and since decision 57 there is no
    // third plane for it to be, which is what "unknown" says here.
    await app.fetch(req(INTERNAL, "/runs"));
    expect(logged("http.request").map((l) => l.plane)).toEqual(["public", "ingress", "unknown"]);
  });

  it("logs the unknown-host 404, which is the request most likely to be queried", async () => {
    const { app, logged } = build();
    await app.fetch(req("stranger.test", "/runs"));
    expect(logged("http.request")[0]).toMatchObject({ plane: "unknown", http_status: 404 });
  });

  it("uses the edge ray when there is one, on every plane", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs", { headers: { "cf-ray": "abc123-LHR" } }));
    await app.fetch(req(HOOK, "/nope", { headers: { "cf-ray": "def456-LHR" } }));
    expect(logged("http.request").map((l) => l.ray)).toEqual(["abc123-LHR", "def456-LHR"]);
  });

  it("generates a ray when the edge sent none", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs"));
    expect(String(logged("http.request")[0]?.ray)).toContain(GENERATED_RAY_PREFIX);
  });

  it("gives each request its own ray", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs"));
    await app.fetch(req(INTERNAL, "/public/runs"));
    const [first, second] = logged("http.request");
    expect(first?.ray).not.toBe(second?.ray);
  });

  it("emits exactly one line per request", async () => {
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs"));
    expect(logged("http.request")).toHaveLength(1);
  });

  it("reaches a delegated plane, which builds its own context", async () => {
    // `ui.fetch(c.req.raw)` starts a fresh Hono context, so nothing set with
    // c.set on the outer one survives the hop. The ray travels on the request
    // instead, and each plane re-derives the same value rather than inventing
    // a second — without this, every per-plane conversion logs `ray:
    // undefined`.
    const { app, store, logged } = build();
    const run = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      isPublic: true,
    }).run;
    await app.fetch(req(INTERNAL, `/public/runs/${run.id}`, { headers: { "cf-ray": "edge-1" } }));
    // The outer line and the plane's own view of the ray must agree.
    expect(logged("http.request")[0]?.ray).toBe("edge-1");
  });

  it("ignores a ray a client tried to supply", async () => {
    // The header is this process's own channel between routers. A client that
    // sets it must not be able to choose what its request is filed under.
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/public/runs", { headers: { "x-cujo-ray": "forged" } }));
    expect(logged("http.request")[0]?.ray).not.toBe("forged");
  });

  it("does not call a path public just because it starts with those letters", async () => {
    // /publicity is a 404, not the board, so calling it public would file the
    // wrong path under the plane that serves run data.
    const { app, logged } = build();
    await app.fetch(req(INTERNAL, "/publicity"));
    await app.fetch(req(INTERNAL, "/public/runs"));
    expect(logged("http.request").map((l) => l.plane)).toEqual(["unknown", "public"]);
  });

  it("logs a probe path asked of an unknown host, because that is a 404", async () => {
    // Suppressing by path alone would hide it, and an unknown host asking for
    // /healthz is exactly the request the unknown-host rule exists for.
    const { app, logged } = build();
    await app.fetch(req("stranger.test", "/healthz"));
    expect(logged("http.request")[0]).toMatchObject({ plane: "unknown", http_status: 404 });
  });

  it("names no repo, no person and no assertion", async () => {
    // The request line is metadata. Anything that identifies a person belongs
    // on the event that records a decision, not on every request.
    const { app, lines } = build();
    await app.fetch(
      req(INTERNAL, "/public/runs", {
        headers: { "cf-access-jwt-assertion": "good", cookie: "s=secret" },
      }),
    );
    const body = JSON.stringify(lines);
    expect(body).not.toContain("good");
    expect(body).not.toContain("secret");
  });
});
