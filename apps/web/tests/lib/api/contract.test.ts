import {
  CHECK_NAMES,
  RUN_STATUSES,
  SEVERITIES,
  canDecide,
  gatedReviewPosted,
  isLive,
  reviewPosted,
} from "@/lib/api/types";
import type { CheckState, Finding, ReviewTool, Run } from "@/lib/api/types";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_RUN_FIELDS,
  PUBLIC_SUMMARY_FIELDS,
} from "../../../../cujo/src/http/public/serialize";
import { CHECK_NAMES as CUJO_CHECK_NAMES } from "../../../../cujo/src/review/types";
import type {
  CheckState as CujoCheckState,
  Finding as CujoFinding,
} from "../../../../cujo/src/review/types";

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
    // `threadId` is restated rather than spread: it is optional on this side
    // because the public plane withholds it, and required on cujo's, where
    // every check has one (decision 34).
    const asCujo: CujoCheckState = {
      ...check,
      threadId: check.threadId ?? "t",
      startedAt: null,
      endedAt: null,
    };
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
  const draft = (tool: ReviewTool) => ({
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

  it("does not call an advisory review posted while the turn is still running", () => {
    // The one state that has to stay conservative: the fold records the call
    // from the model message, which can arrive a moment before the POST it
    // describes comes back.
    expect(
      reviewPosted({ ...base, status: "running", review: draft("post_advisory_review") } as Run),
    ).toBe(false);
  });

  it("calls the observation posted while the accusation is still pending", () => {
    // `blocked_pending` is a statement about `gated_review`, not this slot. The
    // advisory posted before the pause, and saying otherwise sends a reader
    // looking for something that is plainly on the pull request.
    expect(
      reviewPosted({
        ...base,
        status: "blocked_pending",
        review: draft("post_advisory_review"),
      } as Run),
    ).toBe(true);
  });

  it("treats a blocking review as posted too, because it is no longer gated", () => {
    // `review` only ever holds an ungated call now: both tools that land there
    // post during the turn. The accusation that waits is `gated_review`.
    for (const status of ["blocked_unattended", "error", "superseded"] as const) {
      expect(reviewPosted({ ...base, status, review: draft("post_blocking_review") } as Run)).toBe(
        true,
      );
    }
    expect(
      reviewPosted({ ...base, status: "running", review: draft("post_blocking_review") } as Run),
    ).toBe(false);
  });
});

describe("gatedReviewPosted", () => {
  const gated = {
    tool: "post_gated_review" as const,
    toolCallId: "c2",
    body: "b",
    comments: [],
    findings: [],
  };

  it("says no when nothing was held", () => {
    expect(gatedReviewPosted({ ...base, status: "blocked_posted" } as Run)).toBe(false);
  });

  it("waits for the confirmation, and says no in every other state", () => {
    expect(
      gatedReviewPosted({ ...base, status: "blocked_posted", gated_review: gated } as Run),
    ).toBe(true);
    // `blocked_pending` is the one that matters: the accusation is drafted and
    // is not on the pull request, and calling it posted would be a lie about
    // something that harms a person if it is wrong.
    for (const status of [
      "running",
      "blocked_pending",
      "denied",
      "error",
      "superseded",
      "blocked_unattended",
    ] as const) {
      expect(gatedReviewPosted({ ...base, status, gated_review: gated } as Run)).toBe(false);
    }
  });
});

/**
 * The public plane's wire shape, cross-checked the same way (decision 34).
 *
 * `apps/web` renders both planes with one set of components, so the fields the
 * public serializer withholds have to be exactly the ones this app treats as
 * optional. A field added on either side without the other fails here.
 */
describe("the public wire shape tracks apps/cujo", () => {
  /** Keys a public payload always carries, so they must not be optional here. */
  const REQUIRED_ON_BOTH_PLANES = [
    "id",
    "repo",
    "pr_number",
    "head_sha",
    "status",
    "created_at",
    "updated_at",
  ];

  it("keeps the summary shape to what a public list can carry", () => {
    expect([...PUBLIC_SUMMARY_FIELDS].sort()).toEqual([...REQUIRED_ON_BOTH_PLANES].sort());
  });

  it("never publishes a field this app treats as operator-only", () => {
    for (const field of [
      "approver",
      "decided_at",
      "session_id",
      "turn_ids",
      "approval",
      "external_resume",
    ]) {
      expect(PUBLIC_RUN_FIELDS).not.toContain(field);
      expect(PUBLIC_SUMMARY_FIELDS).not.toContain(field);
    }
  });

  /**
   * The other direction: a public payload has to satisfy `Run`, or the shared
   * components could not render it. This compiles only while every field the
   * public plane omits is optional in `types.ts`.
   */
  it("type-checks a public payload as a Run, and offers no decision on it", () => {
    const publicRun: Run = {
      id: "r1",
      repo: "o/r",
      pr_number: 7,
      head_sha: "abc1234",
      status: "blocked_pending",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:01:00.000Z",
      checks: [],
      findings: [],
      hard_rule_hits: [],
      review: null,
      error: null,
      summary: null,
    };
    expect(publicRun.approver).toBeUndefined();
    // No approval on the public plane, so the decision surface never appears.
    expect(canDecide(publicRun)).toBe(false);
  });

  it("carries every emitted key the shared components read", () => {
    for (const field of [...REQUIRED_ON_BOTH_PLANES, "checks", "findings", "review", "summary"]) {
      expect(PUBLIC_RUN_FIELDS).toContain(field);
    }
  });
});
