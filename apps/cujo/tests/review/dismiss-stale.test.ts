import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { type DismissStaleReviewsDeps, dismissStaleReviews } from "../../src/review/dismiss-stale";
import { fold } from "../../src/review/fold";
import type { Projection, RunRecord } from "../../src/review/types";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    repo: "o/r",
    prNumber: 1,
    headSha: "new-head-sha",
    sessionId: "s",
    turnIds: [],
    deliveryId: null,
    status: "clean",
    approver: null,
    decidedAt: null,
    isPublic: true,
    createdAt: "2026-08-29T10:00:00Z",
    updatedAt: "2026-08-29T10:00:00Z",
    ...overrides,
  };
}

function projection(overrides: Partial<Projection> = {}): Projection {
  return { ...fold([]), ...overrides };
}

function deps(
  reviews: { id: number; commitId: string; state: string }[] = [],
  headSha = "new-head-sha",
): DismissStaleReviewsDeps & { dismissReview: ReturnType<typeof vi.fn> } {
  const dismissReview = vi.fn().mockResolvedValue(undefined);
  return {
    github: {
      pullRequestHead: vi.fn().mockResolvedValue({ headSha, author: "someone" }),
      listBotReviews: vi.fn().mockResolvedValue(reviews),
      dismissReview,
    },
    log: createLogger({ service: "test", level: "error" }),
    dismissReview,
  };
}

describe("dismissStaleReviews", () => {
  it("dismisses stale REQUEST_CHANGES when the new run is clean", async () => {
    const d = deps([{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).toHaveBeenCalledOnce();
    expect(d.dismissReview).toHaveBeenCalledWith("o/r", 1, 123, expect.stringContaining("new-hea"));
  });

  it("does NOT dismiss when projection status is not clean", async () => {
    for (const status of [
      "error",
      "blocked_pending",
      "blocked_unattended",
      "blocked_posted",
      "denied",
      "superseded",
      "running",
    ] as const) {
      const d = deps([{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }]);
      await dismissStaleReviews(d, run(), projection({ status }));
      expect(d.github.pullRequestHead).not.toHaveBeenCalled();
      expect(d.github.listBotReviews).not.toHaveBeenCalled();
      expect(d.dismissReview).not.toHaveBeenCalled();
    }
  });

  it("does NOT dismiss when PR head has moved past this run", async () => {
    const d = deps(
      [{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }],
      "even-newer-sha",
    );
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.github.pullRequestHead).toHaveBeenCalledOnce();
    expect(d.github.listBotReviews).not.toHaveBeenCalled();
    expect(d.dismissReview).not.toHaveBeenCalled();
  });

  it("does NOT dismiss when pullRequestHead returns null (deleted PR)", async () => {
    const d = deps([{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }]);
    (d.github.pullRequestHead as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.github.listBotReviews).not.toHaveBeenCalled();
    expect(d.dismissReview).not.toHaveBeenCalled();
  });

  it("does NOT dismiss reviews on the current head SHA", async () => {
    const d = deps([{ id: 123, commitId: "new-head-sha", state: "CHANGES_REQUESTED" }]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).not.toHaveBeenCalled();
  });

  it("does NOT dismiss COMMENT reviews even if stale", async () => {
    const d = deps([{ id: 456, commitId: "old-sha", state: "COMMENTED" }]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).not.toHaveBeenCalled();
  });

  it("handles zero stale reviews gracefully", async () => {
    const d = deps([]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).not.toHaveBeenCalled();
  });

  it("handles GitHub API error on dismiss gracefully", async () => {
    const d = deps([{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }]);
    d.dismissReview.mockRejectedValueOnce(new Error("403 Forbidden"));
    await expect(
      dismissStaleReviews(d, run(), projection({ status: "clean" })),
    ).resolves.toBeUndefined();
  });

  it("dismisses multiple stale reviews from different commits", async () => {
    const d = deps([
      { id: 100, commitId: "old-sha-1", state: "CHANGES_REQUESTED" },
      { id: 200, commitId: "old-sha-2", state: "CHANGES_REQUESTED" },
    ]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).toHaveBeenCalledTimes(2);
    expect(d.dismissReview).toHaveBeenCalledWith("o/r", 1, 100, expect.any(String));
    expect(d.dismissReview).toHaveBeenCalledWith("o/r", 1, 200, expect.any(String));
  });

  it("dismiss message includes the new head SHA", async () => {
    const d = deps([{ id: 123, commitId: "old-sha", state: "CHANGES_REQUESTED" }], "abc1234567890");
    await dismissStaleReviews(
      d,
      run({ headSha: "abc1234567890" }),
      projection({ status: "clean" }),
    );
    const message = d.dismissReview.mock.calls[0]?.[3] as string;
    expect(message).toContain("abc1234");
  });

  it("only dismisses CHANGES_REQUESTED, not APPROVED or DISMISSED", async () => {
    const d = deps([
      { id: 100, commitId: "old-sha", state: "APPROVED" },
      { id: 200, commitId: "old-sha", state: "DISMISSED" },
      { id: 300, commitId: "old-sha", state: "CHANGES_REQUESTED" },
    ]);
    await dismissStaleReviews(d, run(), projection({ status: "clean" }));
    expect(d.dismissReview).toHaveBeenCalledOnce();
    expect(d.dismissReview).toHaveBeenCalledWith("o/r", 1, 300, expect.any(String));
  });
});
