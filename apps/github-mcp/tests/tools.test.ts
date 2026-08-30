/**
 * The three tools, and the audit line for the only outward write this system
 * makes (decision 37).
 *
 * `review.failed` is the one that matters: a failed file listing, a rejected
 * anchor set or a refused review used to leave `server.ts`'s transport catch
 * as the only record, and that one knows neither the repo nor the pull
 * request.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { reviewMarker } from "../src/body";
import type { GitHubClient } from "../src/github";
import { postReview } from "../src/tools";

const input = {
  repo: "o/r",
  pr_number: 7,
  head_sha: "abc1234",
  body: "What ran",
  // Present because the deprecated field carries a zod default, so it is
  // required on the parsed type. Empty here: these tests are not legacy calls.
  comments: [],
  findings: [],
};

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "github-mcp", sink: (l) => lines.push(JSON.parse(l)) });
  return { log, lines, of: (event: string) => lines.filter((l) => l.event === event) };
}

describe("the maintainer prompt", () => {
  function poster() {
    let posted = "";
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async (_repo: string, _pr: number, req: { body: string }) => {
        posted = req.body;
        return { id: 1, html_url: "https://gh/r/1" };
      }),
    } as unknown as GitHubClient;
    return { github, body: () => posted };
  }

  it("is appended to the observation that holds an accusation back", async () => {
    const { log } = capture();
    const { github, body } = poster();
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      { ...input, accusation_follows: true },
      "",
      log,
    );
    expect(body()).toContain("Reply `/cujo confirm` or `/cujo dismiss`.");
  });

  it("is absent from the accusation, which cannot ask for it", async () => {
    // The regression this exists for. The rubric used to quote the sentence for
    // the agent to reproduce, and it reproduced it on both halves — so the
    // published accusation asked a maintainer to confirm something they had
    // already confirmed, since the approval is what let this call run at all.
    const { log } = capture();
    const { github, body } = poster();
    await postReview(github, "REQUEST_CHANGES", "post_gated_review", input, "", log);
    expect(body()).not.toContain("supply-chain pattern");
    expect(body()).not.toContain("/cujo confirm");
  });

  it("is absent from an ordinary review that nothing follows", async () => {
    const { log } = capture();
    const { github, body } = poster();
    await postReview(github, "COMMENT", "post_advisory_review", input, "", log);
    expect(body()).not.toContain("/cujo confirm");
  });
});

describe("review.posted", () => {
  it("records the repo, the tool and what was actually posted", async () => {
    const { log, of } = capture();
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => ({ id: 99, html_url: "https://gh/r/1" })),
    } as unknown as GitHubClient;
    await postReview(github, "REQUEST_CHANGES", "post_blocking_review", input, "", log);
    expect(of("review.posted")[0]).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      tool: "post_blocking_review",
      review_id: "99",
      posted_inline: 0,
      moved_to_body: 0,
    });
  });

  it("names the gated tool, which posts the same review as the blocking one", async () => {
    const { log, of } = capture();
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => ({ id: 100, html_url: "https://gh/r/2" })),
    } as unknown as GitHubClient;
    await postReview(github, "REQUEST_CHANGES", "post_gated_review", input, "", log);
    // Both REQUEST_CHANGES tools reach GitHub identically, so the event can no
    // longer say which one ran; only the name passed in can.
    expect(github.createReview).toHaveBeenCalledWith(
      "o/r",
      7,
      expect.objectContaining({ event: "REQUEST_CHANGES" }),
    );
    expect(of("review.posted")[0]).toMatchObject({ tool: "post_gated_review", review_id: "100" });
  });
});

describe("the composed body", () => {
  function poster() {
    let posted = "";
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async (_repo: string, _pr: number, req: { body: string }) => {
        posted = req.body;
        return { id: 1, html_url: "https://gh/r/1" };
      }),
    } as unknown as GitHubClient;
    return { github, body: () => posted };
  }

  it("leads with a verdict headline on every tool", async () => {
    for (const [tool, event, headline] of [
      ["post_advisory_review", "COMMENT", "**Advisory** — no findings above info"],
      ["post_blocking_review", "REQUEST_CHANGES", "**Blocked** — no findings above info"],
      [
        "post_gated_review",
        "REQUEST_CHANGES",
        "**Accusation, pending confirmation** — no findings above info",
      ],
    ] as const) {
      const { log } = capture();
      const { github, body } = poster();
      await postReview(github, event, tool, input, "", log);
      expect(body().split("\n")[0]).toBe(headline);
    }
  });

  it("keeps the three appended blocks below everything it composed", async () => {
    // The order the review is read in: what happened, then the evidence folds,
    // then the call to action, then the link, then the marker nobody sees.
    const { log } = capture();
    const { github, body } = poster();
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      { ...input, accusation_follows: true, run_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" },
      "https://cujo.example.com",
      log,
    );
    const at = (needle: string) => body().indexOf(needle);
    expect(at("Machine-readable summary")).toBeGreaterThan(at("**Advisory**"));
    expect(at("/cujo confirm")).toBeGreaterThan(at("Machine-readable summary"));
    expect(at("View the full evidence")).toBeGreaterThan(at("/cujo confirm"));
    expect(at("<!-- cujo:")).toBeGreaterThan(at("View the full evidence"));
  });
});

describe("a call from a session pinned to the old rubric", () => {
  function poster() {
    let posted: { body: string; comments: unknown[] } = { body: "", comments: [] };
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => [
        { filename: "a.py", patch: "@@ -1,1 +1,2 @@\n context\n+added" },
      ]),
      createReview: vi.fn(async (_r: string, _p: number, req: typeof posted) => {
        posted = req;
        return { id: 1, html_url: "https://gh/r/1" };
      }),
    } as unknown as GitHubClient;
    return { github, posted: () => posted };
  }

  it("posts the comments it wrote, rather than ones derived from its findings", async () => {
    // The compatibility guarantee, and the reason `comments` is still in the
    // schema: dropping the key had Zod strip it, so a legacy review posted
    // whatever its findings happened to anchor and lost the model's own
    // comment text in silence.
    const { log } = capture();
    const { github, posted } = poster();
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      {
        ...input,
        comments: [{ path: "a.py", line: 2, body: "the model's own words" }],
        findings: [
          {
            check: "probes",
            severity: "warn" as const,
            title: "a finding anchored somewhere else entirely",
            evidence: "",
            held: false,
            path: "a.py",
            line: 1,
          },
        ],
      },
      "",
      log,
    );
    expect(posted().comments).toEqual([
      { path: "a.py", line: 2, side: "RIGHT", body: "the model's own words" },
    ]);
  });

  it("keeps a rejected comment in the body rather than dropping it", async () => {
    // A derived comment that loses its anchor is still printed in the composed
    // body, marked in place. A legacy one is not — its text exists nowhere
    // else — so refusing its anchor would delete it from the review.
    const { log } = capture();
    const { github, posted } = poster();
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      {
        ...input,
        comments: [
          { path: "a.py", line: 2, body: "on a line that exists" },
          { path: "a.py", line: 404, body: "on a line that does not" },
        ],
      },
      "",
      log,
    );
    expect(posted().comments).toHaveLength(1);
    expect(posted().body).toContain("### Findings without a diff anchor");
    expect(posted().body).toContain("`a.py:404` (RIGHT): on a line that does not");
  });

  it("still gets a composed body, with its prose kept below the findings", async () => {
    const { log } = capture();
    const { github, posted } = poster();
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      {
        ...input,
        body: "## What ran\n\n212 tests on base and head.\n\n## Results\n\nNothing broke.",
        comments: [{ path: "a.py", line: 2, body: "x" }],
      },
      "",
      log,
    );
    expect(posted().body).toContain("**Advisory** — no findings above info");
    expect(posted().body).toContain("### Notes");
    expect(posted().body).toContain("212 tests on base and head.");
  });
});

describe("review.anchor.moved", () => {
  it("says why each derived anchor was rejected, which the count alone cannot", async () => {
    const { log, of } = capture();
    const github = {
      // Only a.py is in the diff, and only line 2 of it.
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => [
        { filename: "a.py", patch: "@@ -1,1 +1,2 @@\n context\n+added" },
      ]),
      createReview: vi.fn(async () => ({ id: 1, html_url: "https://gh/r/1" })),
    } as unknown as GitHubClient;
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      {
        ...input,
        // Anchors ride on the findings now (decision 74); one severity for all
        // of them, so the stable sort keeps the order they are written in.
        findings: [
          {
            check: "probes",
            severity: "warn" as const,
            title: "kept",
            evidence: "",
            held: false,
            path: "a.py",
            line: 2,
          },
          {
            check: "probes",
            severity: "warn" as const,
            title: "file is not in the diff",
            evidence: "",
            held: false,
            path: "b.py",
            line: 5,
          },
          {
            check: "probes",
            severity: "warn" as const,
            title: "line is outside the hunk",
            evidence: "",
            held: false,
            path: "a.py",
            line: 99,
          },
          {
            check: "probes",
            severity: "warn" as const,
            title: "no anchor at all",
            evidence: "",
            held: false,
          },
        ],
      },
      "",
      log,
    );
    // `bad_line` is unreachable from here by construction: a derived comment is
    // only emitted for a positive integer line, and the schema demands one too.
    // The branch stays in `validateAnchors`, which has its own test.
    expect(of("review.anchor.moved").map((l) => l.reason)).toEqual([
      "file_not_in_diff",
      "line_not_in_hunk",
    ]);
    expect(of("review.posted")[0]).toMatchObject({ posted_inline: 1, moved_to_body: 2 });
  });
});

describe("review.failed", () => {
  it("names the repo and the pull request the transport catch cannot", async () => {
    const { log, of } = capture();
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => {
        throw Object.assign(new Error("GitHub /pulls/7/files failed"), { status: 502 });
      }),
      createReview: vi.fn(),
    } as unknown as GitHubClient;
    await expect(
      postReview(github, "COMMENT", "post_advisory_review", input, "", log),
    ).rejects.toThrow();
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
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => {
        throw new Error("422 unprocessable");
      }),
    } as unknown as GitHubClient;
    await expect(
      postReview(github, "COMMENT", "post_advisory_review", input, "", log),
    ).rejects.toThrow("422");
  });
});

describe("the duplicate review check", () => {
  const RUN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const input = (over: Record<string, unknown> = {}) => ({
    repo: "o/r",
    pr_number: 7,
    head_sha: "abc1234",
    body: "What ran.",
    comments: [],
    findings: [],
    run_id: RUN,
    ...over,
  });

  /** A client whose pull request already carries `reviews`. */
  function clientWith(reviews: unknown[]) {
    const createReview = vi.fn(async () => ({ id: 99, html_url: "https://gh/r/99" }));
    const github = {
      listReviews: vi.fn(async () => reviews),
      listPullFiles: vi.fn(async () => []),
      createReview,
    } as unknown as GitHubClient;
    return { github, createReview };
  }

  const botReview = (body: string) => ({
    id: 42,
    html_url: "https://gh/r/42",
    body,
    user: { login: "cujo-guard[bot]", type: "Bot" },
  });

  it("writes a marker into the review it posts", async () => {
    const { log } = capture();
    const { github } = clientWith([]);
    await postReview(github, "COMMENT", "post_advisory_review", input(), "", log);
    expect(github.createReview).toHaveBeenCalledWith(
      "o/r",
      7,
      expect.objectContaining({
        body: expect.stringContaining(reviewMarker("post_advisory_review", "abc1234", RUN)),
      }),
    );
  });

  it("refuses the identical second call and answers with the review already there", async () => {
    const { log, of } = capture();
    const marker = reviewMarker("post_advisory_review", "abc1234", RUN);
    const { github, createReview } = clientWith([botReview(`What ran.\n\n${marker}\n`)]);
    const second = await postReview(github, "COMMENT", "post_advisory_review", input(), "", log);
    expect(createReview).not.toHaveBeenCalled();
    // The review that is already there, not an error: a thrown tool error is
    // something a model may work around or retry, and idempotent means the
    // second call answers like the first.
    expect(second).toMatchObject({ review_id: 42, html_url: "https://gh/r/42" });
    expect(of("review.duplicate.skipped")).toHaveLength(1);
  });

  it("lets the malice path post both of its reviews on one head", async () => {
    // The observation and the accusation. When a run has a broken thing too,
    // both are REQUEST_CHANGES, so only the tool tells them apart.
    const { log } = capture();
    const blocking = reviewMarker("post_blocking_review", "abc1234", RUN);
    const { github, createReview } = clientWith([botReview(`Body.\n\n${blocking}\n`)]);
    await postReview(github, "REQUEST_CHANGES", "post_gated_review", input(), "", log);
    expect(createReview).toHaveBeenCalledTimes(1);
  });

  it("lets a re-review of the same head post, because it is a new run", async () => {
    const { log } = capture();
    const older = reviewMarker("post_advisory_review", "abc1234", RUN);
    const { github, createReview } = clientWith([botReview(`Body.\n\n${older}\n`)]);
    const rerun = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
    await postReview(github, "COMMENT", "post_advisory_review", input({ run_id: rerun }), "", log);
    expect(createReview).toHaveBeenCalledTimes(1);
  });

  it("is not suppressed by a marker somebody pasted into their own review", async () => {
    // A marker is copyable. Without the account-type check a stranger could
    // silence Cujo on a pull request by quoting one.
    const { log } = capture();
    const marker = reviewMarker("post_advisory_review", "abc1234", RUN);
    const human = {
      id: 7,
      html_url: "https://gh/r/7",
      body: `looks fine to me\n\n${marker}\n`,
      user: { login: "someone", type: "User" },
    };
    const { github, createReview } = clientWith([human]);
    await postReview(github, "COMMENT", "post_advisory_review", input(), "", log);
    expect(createReview).toHaveBeenCalledTimes(1);
  });

  it("does not even look when there is no run id to key on", async () => {
    // A private repository. The server cannot tell a duplicate from a
    // re-review there, so it does not guess and does not spend the API call.
    const { log } = capture();
    const { github, createReview } = clientWith([]);
    await postReview(
      github,
      "COMMENT",
      "post_advisory_review",
      input({ run_id: undefined }),
      "",
      log,
    );
    expect(github.listReviews).not.toHaveBeenCalled();
    expect(createReview).toHaveBeenCalledTimes(1);
  });
});

describe("the duplicate check runs again just before the write", () => {
  const RUN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const base = {
    repo: "o/r",
    pr_number: 7,
    head_sha: "abc1234",
    body: "What ran.",
    comments: [],
    findings: [],
    run_id: RUN,
  };

  it("refuses a review that appeared while this call was reading", async () => {
    // The window a single check leaves open: the file listing and the anchor
    // validation sit between the check and the write. GitHub has no conditional
    // create, so this cannot be made atomic — the second check makes the gap one
    // API call wide instead of three.
    const marker = reviewMarker("post_advisory_review", "abc1234", RUN);
    const raced = {
      id: 42,
      html_url: "https://gh/r/42",
      body: `What ran.\n\n${marker}\n`,
      user: { login: "cujo-guard[bot]", type: "Bot" },
    };
    let call = 0;
    const createReview = vi.fn(async () => ({ id: 99, html_url: "https://gh/r/99" }));
    const github = {
      // Empty on the early check, then carrying the other call's review by the
      // time the late one runs.
      listReviews: vi.fn(async () => (++call === 1 ? [] : [raced])),
      listPullFiles: vi.fn(async () => []),
      createReview,
    } as unknown as GitHubClient;

    const { log, of } = capture();
    const result = await postReview(github, "COMMENT", "post_advisory_review", base, "", log);
    expect(createReview).not.toHaveBeenCalled();
    expect(result).toMatchObject({ review_id: 42 });
    expect(of("review.duplicate.skipped")).toHaveLength(1);
  });

  it("costs one read, not two, when the early check already finds it", async () => {
    const marker = reviewMarker("post_advisory_review", "abc1234", RUN);
    const github = {
      listReviews: vi.fn(async () => [
        {
          id: 42,
          html_url: "https://gh/r/42",
          body: marker,
          user: { login: "cujo-guard[bot]", type: "Bot" },
        },
      ]),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(),
    } as unknown as GitHubClient;
    const { log } = capture();
    await postReview(github, "COMMENT", "post_advisory_review", base, "", log);
    expect(github.listReviews).toHaveBeenCalledTimes(1);
    expect(github.listPullFiles).not.toHaveBeenCalled();
  });

  it("spends no read at all without a run id to key on", async () => {
    const github = {
      listReviews: vi.fn(async () => []),
      listPullFiles: vi.fn(async () => []),
      createReview: vi.fn(async () => ({ id: 1, html_url: "https://gh/r/1" })),
    } as unknown as GitHubClient;
    const { log } = capture();
    const { run_id: _run, ...noRun } = base;
    await postReview(github, "COMMENT", "post_advisory_review", noRun, "", log);
    expect(github.listReviews).not.toHaveBeenCalled();
    expect(github.createReview).toHaveBeenCalledTimes(1);
  });
});
