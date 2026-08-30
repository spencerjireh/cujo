/**
 * The board and the pull request describe a review the same way (decision 74).
 *
 * This is the test the first cut of that decision did not have. It derived the
 * inline comments twice — once in `github-mcp` to post them, once here to show
 * them — and the two copies drifted in three separate ways before review
 * caught it: a dedupe key missing `check`, a title translated on one side
 * only, and a board showing the one-sentence lede where GitHub had the whole
 * review.
 *
 * Both sides now call `@cujo/review-render`, so what this asserts is that
 * `parseReview` really routes through it rather than growing a second
 * implementation again.
 */

import { renderReviewBody, reviewComments } from "@cujo/review-render";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import { parseReview } from "../../src/review/fold";

const args = {
  body: "A dependency added by this PR reads credentials while it installs.",
  findings: [
    {
      check: "detonation",
      severity: "critical",
      // The case the whole decision is about: a title that is still a field
      // name, which one side used to translate and the other did not.
      title: "secret_probe.decoy_read: true",
      evidence: "read at 12:04:31 during pip install",
      detail: "Nothing in the package's stated purpose needs the environment.",
      next: "drop the dependency, or pin an audited version",
      path: "pyproject.toml",
      line: 7,
    },
    {
      check: "probes",
      severity: "warn",
      title: "no test covers the refund path",
      evidence: "refund_window() is called by nothing under tests/",
      path: "app/refunds.py",
      line: 17,
    },
  ],
  coverage: { ran: [{ check: "tests", note: "212 on base and head" }], skipped: [] },
  egress: [{ host: "pypi.org", port: 443, known: true }],
};

const call = (name: string): TrueForgeApi.ChatCompletionMessageToolCall =>
  ({
    id: "call-1",
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  }) as unknown as TrueForgeApi.ChatCompletionMessageToolCall;

describe("what the board shows", () => {
  it("is the body github-mcp composes, not the lede the model sent", () => {
    const parsed = parseReview(call("post_blocking_review"));
    expect(parsed?.composedBody).toBe(
      renderReviewBody(args as Parameters<typeof renderReviewBody>[0], {
        tool: "post_blocking_review",
        accusationFollows: false,
        runUrl: null,
      }),
    );
    // The lede is kept too, but it is not the review.
    expect(parsed?.body).toBe(args.body);
    expect(parsed?.composedBody).not.toBe(parsed?.body);
  });

  it("carries the verdict, the findings, the coverage and the egress", () => {
    const body = parseReview(call("post_blocking_review"))?.composedBody ?? "";
    expect(body).toContain("**Blocked** — 1 critical, 1 warn");
    expect(body).toContain("### Coverage");
    expect(body).toContain("Egress: 1 known host.");
  });

  it("translates a field-name title exactly as the posted review does", () => {
    const body = parseReview(call("post_blocking_review"))?.composedBody ?? "";
    expect(body).toContain("**the seeded decoy secret was read**");
    // The raw expression survives, moved to where a field name belongs.
    expect(body).toContain("secret_probe.decoy_read: true; read at 12:04:31");
  });

  it("derives the same inline comments github-mcp derives, byte for byte", () => {
    expect(parseReview(call("post_advisory_review"))?.comments).toEqual(
      reviewComments(args as Parameters<typeof reviewComments>[0]),
    );
  });

  it("reads the accusation's held markers off its own call", () => {
    const held = {
      ...args,
      findings: [{ ...args.findings[0], severity: "warn", held: true }],
      accusation_follows: true,
    };
    const parsed = parseReview({
      id: "call-2",
      type: "function",
      function: { name: "post_advisory_review", arguments: JSON.stringify(held) },
    } as unknown as TrueForgeApi.ChatCompletionMessageToolCall);
    expect(parsed?.composedBody).toContain("(1 held)");
    expect(parsed?.composedBody).toContain("· held");
  });
});
