/**
 * The two tools, and the audit line for the only outward write this system
 * makes (decision 37).
 *
 * `review.failed` is the one that matters: a failed file listing, a rejected
 * anchor set or a refused review used to leave `server.ts`'s transport catch
 * as the only record, and that one knows neither the repo nor the pull
 * request.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../src/github";
import { postReview } from "../src/tools";

const input = {
  repo: "o/r",
  pr_number: 7,
  head_sha: "abc1234",
  body: "What ran",
  comments: [],
  findings: [],
};

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "github-mcp", sink: (l) => lines.push(JSON.parse(l)) });
  return { log, lines, of: (event: string) => lines.filter((l) => l.event === event) };
}

describe("review.posted", () => {
  it("records the repo, the tool and what was actually posted", async () => {
    const { log, of } = capture();
    const github = {
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => ({ id: 99, html_url: "https://gh/r/1" })),
    } as unknown as GitHubClient;
    await postReview(github, "REQUEST_CHANGES", input, "", log);
    expect(of("review.posted")[0]).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      tool: "post_blocking_review",
      review_id: "99",
      posted_inline: 0,
      moved_to_body: 0,
    });
  });
});

describe("review.anchor.moved", () => {
  it("says why each anchor was rejected, which the count alone cannot", async () => {
    const { log, of } = capture();
    const github = {
      // Only a.py is in the diff, and only line 2 of it.
      listPullFiles: vi.fn(async () => [
        { filename: "a.py", patch: "@@ -1,1 +1,2 @@\n context\n+added" },
      ]),
      createReview: vi.fn(async () => ({ id: 1, html_url: "https://gh/r/1" })),
    } as unknown as GitHubClient;
    await postReview(
      github,
      "COMMENT",
      {
        ...input,
        comments: [
          { path: "a.py", line: 2, body: "kept" },
          { path: "b.py", line: 5, body: "file is not in the diff" },
          { path: "a.py", line: 99, body: "line is outside the hunk" },
          { path: "a.py", line: 0, body: "not a line at all" },
        ],
      },
      "",
      log,
    );
    expect(of("review.anchor.moved").map((l) => l.reason)).toEqual([
      "file_not_in_diff",
      "line_not_in_hunk",
      "bad_line",
    ]);
    expect(of("review.posted")[0]).toMatchObject({ posted_inline: 1, moved_to_body: 3 });
  });
});

describe("review.failed", () => {
  it("names the repo and the pull request the transport catch cannot", async () => {
    const { log, of } = capture();
    const github = {
      listPullFiles: vi.fn(async () => {
        throw Object.assign(new Error("GitHub /pulls/7/files failed"), { status: 502 });
      }),
      createReview: vi.fn(),
    } as unknown as GitHubClient;
    await expect(postReview(github, "COMMENT", input, "", log)).rejects.toThrow();
    expect(of("review.failed")[0]).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      tool: "post_advisory_review",
      error_kind: "http_error",
      error_status: 502,
    });
  });

  it("rethrows, so the tool still fails the way the caller expects", async () => {
    const { log } = capture();
    const github = {
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => {
        throw new Error("422 unprocessable");
      }),
    } as unknown as GitHubClient;
    await expect(postReview(github, "COMMENT", input, "", log)).rejects.toThrow("422");
  });
});
