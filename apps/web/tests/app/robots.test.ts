import robots from "@/app/robots";
import { describe, expect, it } from "vitest";

/**
 * One line of `robots.ts` stands between an anonymous board of other
 * people's pull requests and a search index, and that line now has an
 * exception in it. So it gets a test: a future edit that widens `allow`, or
 * drops `disallow` while rearranging the object, fails here rather than in a
 * crawl nobody watches.
 */
describe("robots", () => {
  it("keeps the board out of the index and lets the manual in", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/docs", disallow: "/" } });
  });
});
