/**
 * The one comment a run may post when the agent said nothing (decisions 109,
 * 110).
 *
 * Two properties carry the whole module and both are asserted here rather than
 * argued about: a malice claim is counted and never named, because the gate
 * exists to stop an accusation reaching a pull request unattended; and a run
 * gets one comment, because a comment is not the idempotent POST a reaction is
 * and `rehydrate` re-folds every run on every restart.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import {
  announceEvidenceGaps,
  announceTimeout,
  evidenceGapBody,
  timeoutBody,
} from "../../src/review/announce";
import { emptyProjection } from "../../src/review/fold";
import type {
  CheckState,
  DraftedReview,
  Finding,
  Projection,
  RunRecord,
} from "../../src/review/types";

const LINKS = { publicBaseUrl: "https://cujo.example" };

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "b5724912",
    repo: "o/orders-api",
    prNumber: 36,
    headSha: "deadbeefcafe",
    sessionId: "s",
    turnIds: ["t1"],
    deliveryId: null,
    prTitle: null,
    prAuthorLogin: null,
    prAuthorId: null,
    model: null,
    rubricSha256: null,
    mode: "sandbox",
    budgetTokens: null,
    status: "error",
    approver: null,
    decidedAt: null,
    isPublic: true,
    createdAt: "2026-09-10T23:07:00Z",
    updatedAt: "2026-09-10T23:37:00Z",
    ...over,
  };
}

function check(over: Partial<CheckState> & { title: string }): CheckState {
  return {
    threadId: `th-${over.title}`,
    isCheck: true,
    status: "done",
    report: { check: over.title },
    error: null,
    startedAt: null,
    endedAt: null,
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    source: "hard_rule",
    check: "tests",
    severity: "warn",
    title: "t",
    evidence: "e",
    ...over,
  };
}

function projection(over: Partial<Projection> = {}): Projection {
  return { ...emptyProjection(), ...over };
}

/** The shape of `b5724912`: two checks reported, `smoke` hung, no review. */
function timedOut(over: Partial<Projection> = {}): Projection {
  return projection({
    status: "error",
    error: "turn timeout: no terminal event",
    checks: [
      check({ title: "tests" }),
      check({ title: "probes" }),
      check({ title: "smoke", status: "running", report: null }),
    ],
    ...over,
  });
}

function deps(over: { claim?: () => boolean } = {}) {
  const createComment = vi.fn(async () => 1234);
  const lines: Record<string, unknown>[] = [];
  return {
    createComment,
    lines,
    deps: {
      github: { createComment },
      log: createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) }),
      claim: over.claim ?? ((): boolean => true),
      links: LINKS,
    },
  };
}

describe("timeoutBody", () => {
  it("names the check that hung and the ones that reported", () => {
    const body = timeoutBody(LINKS, run(), timedOut(), 30 * 60 * 1000);
    expect(body).toContain("30 minute ceiling");
    expect(body).toContain("`smoke` still running");
    expect(body).toContain("from 2 of 4 checks");
    expect(body).toContain("`tests` reported");
    expect(body).toContain("`probes` reported");
  });

  it("links the run's evidence page when the repo is public", () => {
    expect(timeoutBody(LINKS, run(), timedOut(), 1000)).toContain(
      "(https://cujo.example/runs/b5724912)",
    );
  });

  it("links nothing for a private run, because it has no page", () => {
    // Decision 57: the board serves public repos only, and there is no second
    // gated hostname to fall back to. A link into a 404 is worse than none.
    const body = timeoutBody(LINKS, run({ isPublic: false }), timedOut(), 1000);
    expect(body).not.toContain("https://cujo.example");
  });

  it("names a correctness critical, which decision 42 already posts unattended", () => {
    const body = timeoutBody(
      LINKS,
      run(),
      timedOut({
        findings: [
          finding({
            severity: "critical",
            rule: "tests_failed",
            title: "1 test passes on base and fails on head",
            evidence: "AssertionError: 10.05 != 10.04",
          }),
        ],
      }),
      1000,
    );
    expect(body).toContain("1 test passes on base and fails on head");
    expect(body).toContain("AssertionError");
  });

  it("counts a malice claim and never names it", () => {
    // The property the gate exists for. Naming the accusation here would post
    // it unattended by a route nobody argued for.
    const body = timeoutBody(
      LINKS,
      run(),
      timedOut({
        findings: [
          finding({
            severity: "critical",
            rule: "decoy_read",
            title: "the decoy credential was read during detonation",
            evidence: "evil-package read /home/cujo/.aws/credentials",
          }),
        ],
      }),
      1000,
    );
    expect(body).toContain("One finding is held for a person to see first");
    expect(body).not.toContain("decoy");
    expect(body).not.toContain("credentials");
    expect(body).not.toContain("evil-package");
  });

  it("says so plainly when nothing reported at all", () => {
    const body = timeoutBody(LINKS, run(), projection({ status: "error" }), 1000);
    expect(body).toContain("No check reported before the ceiling");
  });

  it("separates a gap in the evidence from a claim about the code", () => {
    const body = timeoutBody(
      LINKS,
      run(),
      timedOut({
        findings: [
          finding({
            check: "smoke",
            rule: "report_invalid",
            title: "the smoke report does not match the report schema",
            evidence: "runs.0.schema_version: Required (+31 more)",
          }),
        ],
      }),
      1000,
    );
    expect(body).toContain("say nothing about this code");
    expect(body).toContain("runs.0.schema_version: Required (+31 more)");
  });
});

describe("evidenceGapBody", () => {
  it("lists the operational rules and says the verdict stands", () => {
    const body = evidenceGapBody(LINKS, run(), [
      finding({ rule: "check_missing", check: "detonation", title: "no report", evidence: "-" }),
    ]);
    expect(body).toContain("thinner evidence than it looks");
    expect(body).toContain("do not change the verdict");
    expect(body).toContain("**detonation**");
  });
});

describe("announceEvidenceGaps", () => {
  const review = { tool: "post_advisory_review" } as unknown as DraftedReview;

  it("says nothing when the run posted no review", async () => {
    // A run that said nothing has a different problem, and the timeout comment
    // is the one that describes it.
    const { deps: d, createComment } = deps();
    await announceEvidenceGaps(d, run(), projection({ status: "unproven" }));
    expect(createComment).not.toHaveBeenCalled();
  });

  it("says nothing when every finding is about the code", async () => {
    const { deps: d, createComment } = deps();
    await announceEvidenceGaps(
      d,
      run(),
      projection({ review, findings: [finding({ severity: "critical", rule: "tests_failed" })] }),
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it("posts once when an operational rule tripped", async () => {
    const { deps: d, createComment } = deps();
    await announceEvidenceGaps(
      d,
      run(),
      projection({ review, findings: [finding({ rule: "sensor_unarmed" })] }),
    );
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith(
      "o/orders-api",
      36,
      expect.stringContaining("**tests**"),
    );
  });

  it("posts nothing when the run already used its one comment", async () => {
    const { deps: d, createComment, lines } = deps({ claim: () => false });
    await announceEvidenceGaps(
      d,
      run(),
      projection({ review, findings: [finding({ rule: "sensor_unarmed" })] }),
    );
    expect(createComment).not.toHaveBeenCalled();
    expect(lines.at(-1)).toMatchObject({
      event: "review.announce.skipped",
      reason: "already_announced",
    });
  });
});

describe("announceTimeout", () => {
  it("claims the slot before it writes, so a crash costs a comment and not a copy", async () => {
    const order: string[] = [];
    const createComment = vi.fn(async () => {
      order.push("comment");
      return 1;
    });
    await announceTimeout(
      {
        github: { createComment },
        log: createLogger({ service: "cujo", sink: () => {} }),
        claim: () => {
          order.push("claim");
          return true;
        },
        links: LINKS,
      },
      run(),
      timedOut(),
      1000,
    );
    expect(order).toEqual(["claim", "comment"]);
  });
});
