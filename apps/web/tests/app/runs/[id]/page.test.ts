import { generateMetadata } from "@/app/runs/[id]/page";
import type { Run } from "@/lib/api/types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `generateMetadata` is a data-layer unit in practice: it reads the run the
 * same anonymous caller could read from the same URL and returns plain
 * strings, so it is tested here in the node environment like the client it
 * calls. The page component around it is exercised in Storybook and the
 * browser; nothing it renders depends on this branch.
 */

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  repo: "o/r",
  pr_number: 7,
  head_sha: "a1f9c3e",
  status: "blocked_pending",
  pr_title: "Add a thing",
  created_at: "2026-08-28T10:00:00.000Z",
  updated_at: "2026-08-28T10:00:00.000Z",
  session_id: "s1",
  turn_ids: ["t1"],
  pr_author_login: "octocat",
  pr_author_id: 583231,
  checks: [],
  findings: [
    { source: "hard_rule", check: "tests", severity: "critical", title: "t", evidence: "e" },
    { source: "hard_rule", check: "smoke", severity: "critical", title: "t", evidence: "e" },
  ],
  hard_rule_hits: [],
  review: null,
  external_resume: false,
  error: null,
  summary: null,
  ...over,
});

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

const PARAMS = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run page metadata", () => {
  it("previews a run link as that run", async () => {
    stubFetch(run("r1"));
    const metadata = await generateMetadata(PARAMS("r1"));
    expect(metadata.title).toBe("o/r #7 — Add a thing");
    expect(metadata.description).toContain("Blocked — waiting for a human.");
    expect(metadata.description).toContain("2 critical.");
    expect(metadata.openGraph?.title).toBe("o/r #7 — Add a thing");
  });

  it("names the pull request alone when no title was ever stored", async () => {
    stubFetch(run("r2", { pr_title: null }));
    const metadata = await generateMetadata(PARAMS("r2"));
    expect(metadata.title).toBe("o/r #7");
  });

  it("counts no criticals it does not have", async () => {
    stubFetch(run("r3", { status: "clean", findings: [] }));
    const metadata = await generateMetadata(PARAMS("r3"));
    // "No critical finding" is the status line; a count is what must not
    // appear, because zero criticals is not zero facts.
    expect(metadata.description).not.toMatch(/\d+ critical/u);
  });

  it("stays unfound by search, whatever the preview now says", async () => {
    // Open Graph is about previews, not discoverability: the board is shared
    // by link and not found by search, and a page's robots must not fall
    // through to a default while adding og: tags.
    stubFetch(run("r4"));
    const metadata = await generateMetadata(PARAMS("r4"));
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("reads the anonymous board, with no credential to send", async () => {
    stubFetch(run("r5"));
    await generateMetadata(PARAMS("r5"));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://cujo:8080/public/runs/r5");
    expect(init.headers).toEqual({ accept: "application/json" });
  });

  it("is a 404 for a run the plane will not name, private or missing", async () => {
    // The 404 is the whole answer (decision 57): there is no second page for a
    // private run, and its preview must not become a probe.
    stubFetch({ error: "not found" }, 404);
    await expect(generateMetadata(PARAMS("r6"))).rejects.toThrow();
  });
});
