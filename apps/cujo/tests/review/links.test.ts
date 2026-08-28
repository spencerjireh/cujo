import { describe, expect, it } from "vitest";
import { publicRunId, runUrl } from "../../src/review/links";

const LINKS = {
  uiBaseUrl: "https://cujo-admin.example.com",
  publicBaseUrl: "https://cujo.example.com",
};

const PUBLIC_RUN = { id: "r1", isPublic: true };
const PRIVATE_RUN = { id: "r2", isPublic: false };

describe("runUrl", () => {
  it("sends a public run to the board and a private one to the operator UI", () => {
    expect(runUrl(LINKS, PUBLIC_RUN)).toBe("https://cujo.example.com/runs/r1");
    expect(runUrl(LINKS, PRIVATE_RUN)).toBe("https://cujo-admin.example.com/runs/r2");
  });

  it("falls back to the operator UI when no public host is configured", () => {
    expect(runUrl({ ...LINKS, publicBaseUrl: "" }, PUBLIC_RUN)).toBe(
      "https://cujo-admin.example.com/runs/r1",
    );
  });
});

describe("publicRunId", () => {
  it("returns the id for a public run", () => {
    expect(publicRunId(PUBLIC_RUN)).toBe("r1");
  });

  it("returns nothing for a private run", () => {
    // Never the operator host either: a reader of the pull request would get a
    // login screen, which is worse than no link (decision 36).
    expect(publicRunId(PRIVATE_RUN)).toBe("");
  });

  it("names no host, so the agent cannot redirect the footer", () => {
    // The whole reason this is an id: github-mcp owns the hostname, so nothing
    // the agent read in the pull request can choose where the link points.
    expect(publicRunId(PUBLIC_RUN)).not.toContain("://");
  });
});
