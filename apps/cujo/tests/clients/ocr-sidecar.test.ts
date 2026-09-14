import { describe, expect, it, vi } from "vitest";
import { OcrSidecar } from "../../src/clients/ocr-sidecar";

const input = {
  repo: "o/r",
  prNumber: 7,
  cloneUrl: "https://github.com/o/r.git",
  baseSha: "b".repeat(40),
  headSha: "h".repeat(40),
  title: "t",
  body: "b",
};

type Answer = (url: string, init?: RequestInit) => Response;

function fakeFetch(answer: Answer) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const noSleep = async () => {};
const started = () => new Response(JSON.stringify({ ok: true, id: "job-1" }), { status: 202 });

describe("OcrSidecar.review", () => {
  it("starts the review, polls until done, and hands back the outcome", async () => {
    const outcome = { ok: true, result: { comments: [] }, exitCode: 0, durationMs: 12 };
    let polls = 0;
    const f = fakeFetch((url) => {
      if (url.endsWith("/review")) return started();
      polls += 1;
      return new Response(
        JSON.stringify(
          polls < 3 ? { id: "job-1", state: "running" } : { id: "job-1", state: "done", outcome },
        ),
      );
    });
    const client = new OcrSidecar("http://ocr-sidecar:8083/", 60_000, f.impl, 1, noSleep);
    expect(await client.review(input)).toEqual(outcome);
    expect(f.calls[0]?.url).toBe("http://ocr-sidecar:8083/review");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual(input);
    expect(f.calls.slice(1).every((c) => c.url === "http://ocr-sidecar:8083/review/job-1")).toBe(
      true,
    );
    expect(polls).toBe(3);
  });

  it("never throws: a refusal, a server error, a bad shape and a dead socket are all not ok", async () => {
    const refused = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response(JSON.stringify({ ok: false, error: "busy" }), { status: 429 }))
        .impl,
      1,
      noSleep,
    );
    expect(await refused.review(input)).toEqual({ ok: false, error: "busy" });

    const crashed = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response("<html>", { status: 500 })).impl,
      1,
      noSleep,
    );
    expect(await crashed.review(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("500"),
    });

    const noId = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response(JSON.stringify({ hello: 1 }), { status: 202 })).impl,
      1,
      noSleep,
    );
    expect(await noId.review(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("id"),
    });

    const odd = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch((url) =>
        url.endsWith("/review") ? started() : new Response(JSON.stringify({ state: "weird" })),
      ).impl,
      1,
      noSleep,
    );
    expect(await odd.review(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("shape"),
    });

    const dead = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => {
        throw new TypeError("fetch failed");
      }).impl,
      1,
      noSleep,
    );
    expect(await dead.review(input)).toEqual({ ok: false, error: "fetch failed" });
  });

  it("gives up at its own deadline while the sidecar still says running", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/review")
        ? started()
        : new Response(JSON.stringify({ id: "job-1", state: "running" })),
    );
    const client = new OcrSidecar("http://x", 40, f.impl, 10);
    expect(await client.review(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("did not finish"),
    });
    expect(f.calls.length).toBeGreaterThan(1);
  });
});
