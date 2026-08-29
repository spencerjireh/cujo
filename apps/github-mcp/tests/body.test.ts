import { describe, expect, it } from "vitest";
import { appendConfirmPrompt, appendRunFooter } from "../src/body";

const BASE = "https://cujo.example.com";
const RUN = "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e";

describe("appendRunFooter", () => {
  it("builds the link from the configured base and the run id", () => {
    expect(appendRunFooter("**What ran**\n\n212 tests.", BASE, RUN)).toBe(
      `**What ran**\n\n212 tests.\n\n---\n\nFull evidence: ${BASE}/runs/${RUN}\n`,
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
    expect(out).toContain(`Full evidence: ${BASE}/runs/`);
    expect(out).not.toContain("evil");
  });

  it("does not add a blank line to a body that already ends in one", () => {
    expect(appendRunFooter("Results.\n\n\n", BASE, RUN)).toBe(
      `Results.\n\n---\n\nFull evidence: ${BASE}/runs/${RUN}\n`,
    );
  });

  it("lands after the anchorless findings block", () => {
    // postReview composes appendRunFooter(appendMovedComments(...)), so the
    // footer must be last, not wedged between the body and the findings.
    const withMoved = "Body.\n\n### Findings without a diff anchor\n\n- `a.ts:1` (RIGHT): x\n";
    const out = appendRunFooter(withMoved, BASE, RUN);
    expect(out.indexOf("Full evidence")).toBeGreaterThan(out.indexOf("without a diff anchor"));
    expect(out.endsWith(`Full evidence: ${BASE}/runs/${RUN}\n`)).toBe(true);
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
    expect(out.indexOf("Full evidence")).toBeGreaterThan(out.indexOf("supply-chain pattern"));
    expect(out.endsWith(`Full evidence: ${BASE}/runs/${RUN}\n`)).toBe(true);
  });
});
