import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewRequest } from "../src/request";
import type { ReviewOutcome } from "../src/review";
import { createApp } from "../src/server";

const sha = "a".repeat(40);
const good = {
  repo: "o/r",
  prNumber: 7,
  cloneUrl: "https://github.com/o/r.git",
  baseSha: sha,
  headSha: sha,
  title: "t",
  body: "b",
};

describe("ocr-sidecar", () => {
  const seen: ReviewRequest[] = [];
  let release: (() => void) | null = null;
  const review = async (input: ReviewRequest): Promise<ReviewOutcome> => {
    seen.push(input);
    if (input.title === "hold") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return { ok: true, result: { comments: [1, 2] }, exitCode: 0, durationMs: 5 };
  };
  const server = createApp({ review, maxBodyBytes: 4096 });
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (body: unknown) =>
    fetch(`${base}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("responds 200 ok on /healthz and 404 elsewhere", async () => {
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({
      ok: true,
      service: "ocr-sidecar",
    });
    expect((await fetch(`${base}/review`)).status).toBe(404);
    expect((await fetch(`${base}/other`, { method: "POST" })).status).toBe(404);
  });

  it("answers a valid request with the reviewer's outcome", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      result: { comments: [1, 2] },
      exitCode: 0,
      durationMs: 5,
    });
    expect(seen.at(-1)).toMatchObject({ repo: "o/r", prNumber: 7 });
  });

  it("is 400 on a malformed body, a bad shape, and a foreign clone url", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...good, headSha: "short" })).status).toBe(400);
    const foreign = await post({ ...good, cloneUrl: "https://github.com/someone/else.git" });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({
      ok: false,
      error: "clone url is not the repository under review",
    });
  });

  it("is 413 past the body cap", async () => {
    expect((await post({ ...good, body: "x".repeat(8192) })).status).toBe(413);
  });

  it("is 429 while a review is running, then free again", async () => {
    const held = post({ ...good, title: "hold" });
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(good)).status).toBe(429);
    release?.();
    expect((await held).status).toBe(200);
    expect((await post(good)).status).toBe(200);
  });
});

describe("ocr-sidecar with no model configured", () => {
  const server = createApp({ review: null });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("is healthy and refuses every review with 503", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const res = await fetch(`${base}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(good),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "sidecar has no model configured" });
  });
});
