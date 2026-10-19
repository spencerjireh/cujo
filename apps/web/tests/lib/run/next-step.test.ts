import { RUN_STATUSES } from "@/lib/api/types";
import { headline, nextStep, splitCommands } from "@/lib/run/next-step";
import { describe, expect, it } from "vitest";

describe("headline (decision 175)", () => {
  it("counts the critical findings on a block, in the singular when there is one", () => {
    expect(headline("blocked", 2)).toBe("Blocked by 2 critical findings");
    expect(headline("blocked", 1)).toBe("Blocked by 1 critical finding");
    expect(headline("blocked", 0)).toBe("Blocked");
  });

  it("names a running diff review as one", () => {
    expect(headline("running", 0, "diff")).toBe("Diff review running");
    expect(headline("running", 0, "sandbox")).toBe("Review running");
  });

  it("has a headline for every status", () => {
    for (const status of RUN_STATUSES) expect(headline(status, 0).length).toBeGreaterThan(0);
  });
});

describe("nextStep", () => {
  it("tells a blocked author both ways out", () => {
    const step = nextStep("blocked") ?? "";
    expect(step).toContain("push a new commit");
    expect(step).toContain("/cujo dismiss");
  });

  it("sends an errored run to a re-run, and blames Cujo rather than the pull request", () => {
    expect(nextStep("error")).toContain("Cujo failed, not the pull request");
    expect(nextStep("error")).toContain("/cujo review");
  });
});

describe("splitCommands", () => {
  it("puts each command at an odd index", () => {
    expect(splitCommands("Comment /cujo review on it, or /cujo dismiss.")).toEqual([
      "Comment ",
      "/cujo review",
      " on it, or ",
      "/cujo dismiss",
      ".",
    ]);
  });
});
