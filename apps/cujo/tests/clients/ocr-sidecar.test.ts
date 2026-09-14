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

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("OcrSidecar.review", () => {
  it("posts the input to /review and hands back the outcome", async () => {
    const outcome = { ok: true, result: { comments: [] }, exitCode: 0, durationMs: 12 };
    const f = fakeFetch(() => new Response(JSON.stringify(outcome), { status: 200 }));
    const client = new OcrSidecar("http://ocr-sidecar:8083/", 1000, f.impl);
    expect(await client.review(input)).toEqual(outcome);
    expect(f.calls[0]?.url).toBe("http://ocr-sidecar:8083/review");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual(input);
  });

  it("never throws: a refusal, a server error, a bad shape and a dead socket are all not ok", async () => {
    const refused = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response(JSON.stringify({ ok: false, error: "busy" }), { status: 429 }))
        .impl,
    );
    expect(await refused.review(input)).toEqual({ ok: false, error: "busy" });

    const crashed = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response("<html>", { status: 500 })).impl,
    );
    expect(await crashed.review(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("500"),
    });

    const odd = new OcrSidecar(
      "http://x",
      1000,
      fakeFetch(() => new Response(JSON.stringify({ hello: 1 }), { status: 200 })).impl,
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
    );
    expect(await dead.review(input)).toEqual({ ok: false, error: "fetch failed" });
  });

  it("gives up at its timeout", async () => {
    const slow = fakeFetch(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("{}")), 500);
        }),
    );
    // The fake ignores the signal, so this is the client's own behaviour: it
    // passes a timeout signal, and a real fetch would abort on it.
    const client = new OcrSidecar("http://x", 50, slow.impl);
    await client.review(input);
    const signal = slow.calls[0]?.init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await new Promise((r) => setTimeout(r, 80));
    expect(signal?.aborted).toBe(true);
  });
});
