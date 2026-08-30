import type { RunSummary } from "@/lib/api/types";
import { hasSiblings, latestByPullRequest, pullRequestKey } from "@/lib/board/supersede";
import { describe, expect, it } from "vitest";

function run(id: string, repo: string, pr: number, createdAt: string): RunSummary {
  return {
    id,
    repo,
    pr_number: pr,
    head_sha: `${id}0000000000000000000000000000000000000`,
    status: "clean",
    created_at: createdAt,
    updated_at: createdAt,
    pr_title: null,
  };
}

describe("latestByPullRequest", () => {
  it("keeps the newest run of a pull request pushed to twice", () => {
    const older = run("a", "o/r", 1, "2026-08-30T01:00:00Z");
    const newer = run("b", "o/r", 1, "2026-08-30T02:00:00Z");
    const latest = latestByPullRequest([older, newer]);
    expect(latest.has("b")).toBe(true);
    expect(latest.has("a")).toBe(false);
  });

  it("is indifferent to list order", () => {
    const older = run("a", "o/r", 1, "2026-08-30T01:00:00Z");
    const newer = run("b", "o/r", 1, "2026-08-30T02:00:00Z");
    expect(latestByPullRequest([newer, older])).toEqual(latestByPullRequest([older, newer]));
  });

  it("does not conflate the same number on two repositories", () => {
    const one = run("a", "o/r", 7, "2026-08-30T01:00:00Z");
    const two = run("b", "o/s", 7, "2026-08-30T02:00:00Z");
    const latest = latestByPullRequest([one, two]);
    expect(latest.has("a")).toBe(true);
    expect(latest.has("b")).toBe(true);
  });

  it("names every run latest when nothing was re-pushed", () => {
    const a = run("a", "o/r", 1, "2026-08-30T01:00:00Z");
    const b = run("b", "o/r", 2, "2026-08-30T02:00:00Z");
    expect(latestByPullRequest([a, b]).size).toBe(2);
  });
});

describe("hasSiblings", () => {
  it("is false for a pull request with one run", () => {
    const a = run("a", "o/r", 1, "2026-08-30T01:00:00Z");
    const b = run("b", "o/r", 2, "2026-08-30T02:00:00Z");
    expect(hasSiblings(a, [a, b])).toBe(false);
  });

  it("is true once the pull request has a second run on the board", () => {
    const a = run("a", "o/r", 1, "2026-08-30T01:00:00Z");
    const b = run("b", "o/r", 1, "2026-08-30T02:00:00Z");
    expect(hasSiblings(a, [a, b])).toBe(true);
  });
});

describe("pullRequestKey", () => {
  it("joins repository and number", () => {
    expect(pullRequestKey({ repo: "o/r", pr_number: 12 })).toBe("o/r#12");
  });
});
