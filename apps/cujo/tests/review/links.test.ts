import { describe, expect, it } from "vitest";
import { publicRunId, runUrl } from "../../src/review/links";

const LINKS = { publicBaseUrl: "https://cujo.example.com" };

const PUBLIC_RUN = { id: "r1", isPublic: true };
const PRIVATE_RUN = { id: "r2", isPublic: false };

describe("runUrl", () => {
  it("sends a public run to the board", () => {
    expect(runUrl(LINKS, PUBLIC_RUN)).toBe("https://cujo.example.com/runs/r1");
  });

  it("sends a private run nowhere", () => {
    // There is no second, gated hostname to fall back to since decision 54,
    // and the board serves public repos only — so a link would be a link into
    // a 404. The pull request is where that run is discussed.
    expect(runUrl(LINKS, PRIVATE_RUN)).toBeNull();
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
