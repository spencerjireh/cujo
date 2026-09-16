import { describe, expect, it } from "vitest";
import { publicRunId, pullRequestUrl, runUrl } from "../../src/review/links";

const LINKS = { publicBaseUrl: "https://cujo.example.com" };

const PUBLIC_RUN = { id: "r1", isPublic: true };
const PRIVATE_RUN = { id: "r2", isPublic: false };

describe("runUrl", () => {
  it("sends a public run to the board", () => {
    expect(runUrl(LINKS, PUBLIC_RUN)).toBe("https://cujo.example.com/runs/r1");
  });

  it("sends a private run to the same page, which answers to an owner (decision 159)", () => {
    // The link sits on the repository's own things — its pull request, its
    // check, its channel — and an owner follows it; anyone else meets the
    // board's 404, which says nothing.
    expect(runUrl(LINKS, PRIVATE_RUN)).toBe("https://cujo.example.com/runs/r2");
  });

  it("links nowhere at all when no board is configured", () => {
    expect(runUrl({ publicBaseUrl: "" }, PUBLIC_RUN)).toBeNull();
    expect(runUrl({ publicBaseUrl: "" }, PRIVATE_RUN)).toBeNull();
  });
});

describe("publicRunId", () => {
  it("returns the id for a public run", () => {
    expect(publicRunId(PUBLIC_RUN)).toBe("r1");
  });

  it("returns nothing for a private run", () => {
    // The same rule runUrl applies, reached from the other end: a reader of
    // the pull request has no page to open either (decision 36).
    expect(publicRunId(PRIVATE_RUN)).toBe("");
  });

  it("names no host, so the agent cannot redirect the footer", () => {
    // The whole reason this is an id: github-mcp owns the hostname, so nothing
    // the agent read in the pull request can choose where the link points.
    expect(publicRunId(PUBLIC_RUN)).not.toContain("://");
  });
});

describe("pullRequestUrl", () => {
  it("builds the link from the repo and the number", () => {
    expect(pullRequestUrl({ repo: "o/r", prNumber: 7 })).toBe("https://github.com/o/r/pull/7");
  });

  it("builds nothing for a repo that is not owner/name", () => {
    // A live link is the one place a hostile string chooses where a reader
    // goes, so the shape is enforced here rather than assumed of the store
    // (rule 7's philosophy, applied to the structural link; decision 86).
    for (const repo of [
      "not a repo",
      "o/r/extra",
      "o/",
      "/r",
      "-lead/r",
      "o/r?pull",
      "o/r#x",
      "o/r two",
      "https://evil.example/o/r",
    ]) {
      expect(pullRequestUrl({ repo, prNumber: 7 }), repo).toBeNull();
    }
  });
});
