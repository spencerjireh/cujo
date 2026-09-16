import { metadata } from "@/app/galaxy/page";
import { describe, expect, it } from "vitest";

/** The board at its own address (decision 160), still out of the index. */
describe("the galaxy page", () => {
  it("is titled as the board and never indexed", () => {
    expect(metadata.title).toBe("The board — cujo");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
