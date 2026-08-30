import { describe, expect, it } from "vitest";
import {
  appendConfirmPrompt,
  appendReviewMarker,
  appendRunFooter,
  reviewMarker,
  runUrl,
} from "../src/body";

const BASE = "https://cujo.example.com";
const RUN = "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e";

describe("appendRunFooter", () => {
  it("builds the link from the configured base and the run id", () => {
    expect(appendRunFooter("**What ran**\n\n212 tests.", BASE, RUN)).toBe(
      `**What ran**\n\n212 tests.\n\n---\n\n**[View the full evidence →](${BASE}/runs/${RUN})**\n`,
    );
  });

  it("leaves the body byte-identical when there is no run id", () => {
    // The private-repo case. A review on a repo with no public page must be
    // exactly what it was before the footer existed.
    const body = "**What ran**\n\n212 tests.";
    expect(appendRunFooter(body, BASE, undefined)).toBe(body);
    expect(appendRunFooter(body, BASE, "")).toBe(body);
  });

  it("leaves the body byte-identical when no board is configured", () => {
    const body = "**What ran**\n\n212 tests.";
    expect(appendRunFooter(body, "", RUN)).toBe(body);
  });

  it("refuses a run id that is not a UUID", () => {
    // The id crosses the agent, which has just read a stranger's pull request.
    // Anything that is not a UUID cannot name a run of ours, so it is dropped
    // rather than pasted into a public review (decision 36).
    const body = "Results.";
    for (const bad of [
      "../../evil",
      "8f3a2c1e",
      `${RUN}\n\n## Merged and approved`,
      `${RUN} https://evil.example.com`,
      "https://evil.example.com/runs/x",
    ]) {
      expect(appendRunFooter(body, BASE, bad)).toBe(body);
    }
  });

  it("cannot be made to point at another host", () => {
    // Whatever the id, the host is the one this process was configured with.
    const out = appendRunFooter("Results.", BASE, RUN);
    expect(out).toContain(`](${BASE}/runs/`);
    expect(out).not.toContain("evil");
  });

  it("puts the URL in the link target and nowhere else", () => {
    // The label is a literal here and the target is `runUrl`'s, so a reader
    // sees words rather than a UUID — and there is exactly one URL in the
    // footer to check, not one rendered and one linked that could differ.
    const out = appendRunFooter("Results.", BASE, RUN);
    expect(out).toContain(`**[View the full evidence →](${BASE}/runs/${RUN})**`);
    expect(out.match(/https:\/\//g)).toHaveLength(1);
  });

  it("does not add a blank line to a body that already ends in one", () => {
    expect(appendRunFooter("Results.\n\n\n", BASE, RUN)).toBe(
      `Results.\n\n---\n\n**[View the full evidence →](${BASE}/runs/${RUN})**\n`,
    );
  });

  it("lands after the composed body, not inside it", () => {
    // postReview composes appendRunFooter(renderReviewBody(...)), so the footer
    // must be last — below the machine-readable fold rather than wedged into
    // the middle of the review.
    const composed =
      "**Advisory** — no findings above info\n\nFine.\n\n<details>\n<summary>x</summary>\n\ny\n\n</details>";
    const out = appendRunFooter(composed, BASE, RUN);
    expect(out.indexOf("View the full evidence")).toBeGreaterThan(out.indexOf("</details>"));
    expect(out.endsWith(`**[View the full evidence →](${BASE}/runs/${RUN})**\n`)).toBe(true);
  });
});

describe("runUrl", () => {
  // Extracted so the machine-readable block and the footer cannot name
  // different pages for one run (decision 74).
  it("builds the page from the configured base and the run id", () => {
    expect(runUrl(BASE, RUN)).toBe(`${BASE}/runs/${RUN}`);
  });

  it("is null when this deployment has no board, or the run has no page", () => {
    expect(runUrl("", RUN)).toBeNull();
    expect(runUrl(BASE, undefined)).toBeNull();
  });

  it("is null for anything that is not a UUID, on the same rule as the footer", () => {
    for (const bad of ["https://evil.example.com/runs/x", `${RUN}\n\n## Merged`, "../../etc"]) {
      expect(runUrl(BASE, bad)).toBeNull();
    }
  });

  it("agrees with the footer, which is the reason it exists", () => {
    expect(appendRunFooter("Body.", BASE, RUN)).toContain(`](${runUrl(BASE, RUN)})`);
  });
});

describe("appendConfirmPrompt", () => {
  it("names both commands when an accusation follows", () => {
    const out = appendConfirmPrompt("Results.", true);
    expect(out).toContain("This matches a supply-chain pattern.");
    expect(out).toContain("`/cujo confirm`");
    expect(out).toContain("`/cujo dismiss`");
  });

  it("leaves the body byte-identical when nothing follows", () => {
    // Which is every review that is not the observation half of a pair: an
    // ordinary advisory, a blocking review for a broken test, and — because
    // the flag does not exist on that tool — every gated review there is.
    const body = "Results.";
    expect(appendConfirmPrompt(body, false)).toBe(body);
  });

  it("does not add a blank line to a body that already ends in one", () => {
    expect(appendConfirmPrompt("Results.\n\n\n", true)).toBe(
      "Results.\n\nThis matches a supply-chain pattern. Cujo will not publish that conclusion until a maintainer confirms. Reply `/cujo confirm` or `/cujo dismiss`.\n",
    );
  });

  it("sits above the evidence link, which stays last", () => {
    // postReview composes appendRunFooter(appendConfirmPrompt(...)), because
    // decision 36 requires the link to be the last thing in the body.
    const out = appendRunFooter(appendConfirmPrompt("Results.", true), BASE, RUN);
    expect(out.indexOf("View the full evidence")).toBeGreaterThan(
      out.indexOf("supply-chain pattern"),
    );
    expect(out.endsWith(`**[View the full evidence →](${BASE}/runs/${RUN})**\n`)).toBe(true);
  });
});

describe("reviewMarker", () => {
  const RUN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("names the tool, the head and the run", () => {
    expect(reviewMarker("post_advisory_review", "abc1234", RUN)).toBe(
      `<!-- cujo:post_advisory_review:abc1234:${RUN} -->`,
    );
  });

  it("tells the two halves of the malice path apart", () => {
    // Both are REQUEST_CHANGES when a run has a broken thing and a malice
    // finding, so a key on the review event would refuse the accusation.
    expect(reviewMarker("post_blocking_review", "abc1234", RUN)).not.toBe(
      reviewMarker("post_gated_review", "abc1234", RUN),
    );
  });

  it("differs per run, so a re-review of the same head still posts", () => {
    const other = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
    expect(reviewMarker("post_advisory_review", "abc1234", RUN)).not.toBe(
      reviewMarker("post_advisory_review", "abc1234", other),
    );
  });

  it("is empty without a run id, which is a private repository", () => {
    // There the server cannot tell a duplicate from a re-review, so it does
    // not guess. Same exposure private repos already had; not a new one.
    expect(reviewMarker("post_advisory_review", "abc1234", undefined)).toBe("");
    expect(reviewMarker("post_advisory_review", "abc1234", "not-a-uuid")).toBe("");
  });

  it("cannot be read back as a /cujo command", () => {
    // `parse-command.ts` drops any line containing `<!--`.
    expect(reviewMarker("post_advisory_review", "abc1234", RUN)).toContain("<!--");
  });
});

describe("appendReviewMarker", () => {
  const RUN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const marker = reviewMarker("post_advisory_review", "abc1234", RUN);

  it("lands last, on its own line", () => {
    const body = appendReviewMarker("What ran.", marker);
    expect(body.trimEnd().endsWith(marker)).toBe(true);
    expect(body).toContain(`\n\n${marker}`);
  });

  it("lands even when there is no footer to hang it off", () => {
    // A private repo has no run id, so `appendRunFooter` returns the body
    // unchanged — a marker composed inside it would vanish with it.
    const withoutFooter = appendRunFooter("What ran.", "", undefined);
    expect(appendReviewMarker(withoutFooter, marker)).toContain(marker);
  });

  it("changes nothing when there is no marker", () => {
    expect(appendReviewMarker("What ran.", "")).toBe("What ran.");
  });
});
