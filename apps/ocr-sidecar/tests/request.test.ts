/**
 * The clone-URL rules, mirrored from `sandbox/tests/test_prepare.py`: the
 * same refusals on the trusted side, for the same reasons.
 */

import { describe, expect, it } from "vitest";
import { ReviewRequest, checkCloneUrl } from "../src/request";

describe("checkCloneUrl", () => {
  it("allows a public https url naming the repository", () => {
    expect(checkCloneUrl("https://github.com/o/r.git", "o/r")).toBeNull();
    expect(checkCloneUrl("http://github.com/o/r.git", "o/r")).toBeNull();
    expect(checkCloneUrl("https://github.com/o/r", "o/r")).toBeNull();
    // Case is GitHub's to fold, and the two spellings are one repository.
    expect(checkCloneUrl("https://github.com/O/R.git", "o/r")).toBeNull();
  });

  it("refuses a credential without echoing it", () => {
    const secret = "s3cr3t-value";
    const refusal = checkCloneUrl(`https://x-access-token:${secret}@github.com/o/r.git`, "o/r");
    expect(refusal).toContain("credentials");
    expect(refusal).not.toContain(secret);
  });

  it("refuses a query or fragment, where a signed url carries its token", () => {
    const secret = "s3cr3t-value";
    const refusal = checkCloneUrl(`https://github.com/o/r.git?token=${secret}`, "o/r");
    expect(refusal).not.toBeNull();
    expect(refusal).not.toContain(secret);
    expect(checkCloneUrl("https://github.com/o/r.git#token=x", "o/r")).not.toBeNull();
  });

  it("refuses ssh, scp and option-shaped forms", () => {
    expect(checkCloneUrl("ssh://git@github.com/o/r.git", "o/r")).not.toBeNull();
    expect(checkCloneUrl("git@github.com:o/r.git", "o/r")).not.toBeNull();
    expect(checkCloneUrl("--upload-pack=touch /tmp/pwned", "o/r")).not.toBeNull();
    expect(checkCloneUrl("https:///o/r.git", "o/r")).not.toBeNull();
  });

  it("refuses another host and another repository on the same host", () => {
    expect(checkCloneUrl("https://gitlab.com/o/r.git", "o/r")).not.toBeNull();
    expect(checkCloneUrl("https://github.com/someone/else.git", "o/r")).not.toBeNull();
    expect(checkCloneUrl("https://github.com/o/r-fork.git", "o/r")).not.toBeNull();
    expect(checkCloneUrl("https://github.com/o/r.git/extra", "o/r")).not.toBeNull();
  });
});

describe("ReviewRequest", () => {
  const sha = "a".repeat(40);
  it("accepts the shape apps/cujo sends and defaults the text", () => {
    const parsed = ReviewRequest.parse({
      repo: "o/r",
      prNumber: 7,
      cloneUrl: "https://github.com/o/r.git",
      baseSha: sha,
      headSha: sha,
    });
    expect(parsed.title).toBe("");
    expect(parsed.body).toBe("");
  });

  it("refuses a short sha, a bad repo and a zero pr number", () => {
    const base = { repo: "o/r", prNumber: 7, cloneUrl: "u", baseSha: sha, headSha: sha };
    expect(() => ReviewRequest.parse({ ...base, headSha: "abc" })).toThrow();
    expect(() => ReviewRequest.parse({ ...base, repo: "o" })).toThrow();
    expect(() => ReviewRequest.parse({ ...base, prNumber: 0 })).toThrow();
  });
});
