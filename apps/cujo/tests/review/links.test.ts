import { describe, expect, it } from "vitest";
import { publicRunUrl, runUrl } from "../../src/review/links";

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

describe("publicRunUrl", () => {
  it("returns the board page for a public run", () => {
    expect(publicRunUrl(LINKS, PUBLIC_RUN)).toBe("https://cujo.example.com/runs/r1");
  });

  it("returns nothing for a private run", () => {
    // Never the operator host: a reader of the pull request would get a login
    // screen, which is worse than no link (decision 36).
    expect(publicRunUrl(LINKS, PRIVATE_RUN)).toBe("");
  });

  it("returns nothing when no public host is configured", () => {
    // The deploy forgot CUJO_PUBLIC_BASE_URL. Every review loses its footer,
    // which is the safe direction; no review fails to post.
    expect(publicRunUrl({ ...LINKS, publicBaseUrl: "" }, PUBLIC_RUN)).toBe("");
  });
});
