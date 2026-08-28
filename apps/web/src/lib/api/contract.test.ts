import { describe, expect, it } from "vitest";
import { CHECK_NAMES as CUJO_CHECK_NAMES } from "../../../../cujo/src/types";
import type {
  CheckState as CujoCheckState,
  Finding as CujoFinding,
} from "../../../../cujo/src/types";
import { CHECK_NAMES, RUN_STATUSES, SEVERITIES, canDecide, isLive, reviewPosted } from "./types";
import type { CheckState, Finding, Run } from "./types";

/**
 * apps/web mirrors the wire types by hand rather than importing the cujo app,
 * whose module graph reaches node:sqlite and the TrueForge SDK. These checks
 * are what keeps the copy honest: a literal union that gains a member in
 * apps/cujo, or a field that changes type, fails here rather than at runtime.
 */
describe("wire types track apps/cujo", () => {
  it("has the same check names", () => {
    expect([...CHECK_NAMES]).toEqual([...CUJO_CHECK_NAMES]);
  });

  it("assigns both ways against the cujo shapes", () => {
    // Type-level assertions; the runtime body only has to compile.
    const check: CheckState = {
      threadId: "t",
      title: "tests",
      isCheck: true,
      status: "done",
      report: null,
      error: null,
      startedAt: "2026-08-28T10:00:00Z",
      endedAt: "2026-08-28T10:01:00Z",
    };
    const asCujo: CujoCheckState = { ...check, startedAt: null, endedAt: null };
    expect(asCujo.title).toBe("tests");

    const finding: Finding = {
      source: "hard_rule",
      check: "tests",
      severity: "critical",
      title: "t",
      evidence: "e",
    };
    const asCujoFinding: CujoFinding = finding;
    expect(asCujoFinding.severity).toBe("critical");
  });

  it("lists every severity the fold can emit", () => {
    expect([...SEVERITIES].sort()).toEqual(["critical", "info", "warn"]);
  });

  it("knows which statuses are still live", () => {
    const live = RUN_STATUSES.filter(isLive);
    expect(live).toEqual(["running", "blocked_pending"]);
  });
});

/** Every field a Run carries except `status`, which each case supplies. */
const base = {
  id: "r1",
  repo: "o/r",
  pr_number: 7,
  head_sha: "abc1234",
  session_id: "s",
  turn_ids: [],
  approver: null,
  decided_at: null,
  created_at: "2026-08-28T10:00:00Z",
  updated_at: "2026-08-28T10:00:00Z",
  checks: [],
  findings: [],
  hard_rule_hits: [],
  review: null,
  approval: null,
  external_resume: false,
  error: null,
  summary: null,
};

describe("canDecide", () => {
  it("allows a decision only while paused on a recorded approval", () => {
    const approval = { threadId: "main", toolCallId: "c1", sourceEventId: "e1" };
    expect(canDecide({ ...base, status: "blocked_pending", approval } as Run)).toBe(true);
  });

  it("refuses when the approval was nulled by the Contract 6 tripwire", () => {
    // An approval raised on a thread other than `main` leaves the run paused
    // with no approval recorded, and must not offer a button.
    expect(canDecide({ ...base, status: "blocked_pending", approval: null } as Run)).toBe(false);
  });

  it("refuses on superseded, decided, and running runs", () => {
    const approval = { threadId: "main", toolCallId: "c1", sourceEventId: "e1" };
    for (const status of ["superseded", "blocked_posted", "denied", "error", "running"] as const) {
      expect(canDecide({ ...base, status, approval } as Run)).toBe(false);
    }
  });
});

describe("reviewPosted", () => {
  const draft = (tool: "post_advisory_review" | "post_blocking_review") => ({
    tool,
    toolCallId: "c1",
    body: "b",
    comments: [],
    findings: [],
  });

  it("says no when there is no review at all", () => {
    expect(reviewPosted({ ...base, status: "running", review: null } as Run)).toBe(false);
  });

  it("treats an advisory review as posted once the run stops running", () => {
    // Advisory reviews are ungated and post during the turn (decision 6), so
    // calling one a draft on a clean run tells the operator the opposite of
    // what is on the pull request.
    for (const status of ["clean", "error", "denied", "superseded", "blocked_posted"] as const) {
      expect(reviewPosted({ ...base, status, review: draft("post_advisory_review") } as Run)).toBe(
        true,
      );
    }
  });

  it("does not call an advisory review posted while the run is still live", () => {
    for (const status of ["running", "blocked_pending"] as const) {
      expect(reviewPosted({ ...base, status, review: draft("post_advisory_review") } as Run)).toBe(
        false,
      );
    }
  });

  it("treats a blocking review as posted only after approval", () => {
    expect(
      reviewPosted({
        ...base,
        status: "blocked_posted",
        review: draft("post_blocking_review"),
      } as Run),
    ).toBe(true);
    for (const status of ["running", "blocked_pending", "denied", "error", "superseded"] as const) {
      expect(reviewPosted({ ...base, status, review: draft("post_blocking_review") } as Run)).toBe(
        false,
      );
    }
  });
});
