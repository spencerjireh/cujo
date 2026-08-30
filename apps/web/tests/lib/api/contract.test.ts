import {
  CHECK_NAMES,
  RUN_STATUSES,
  SEVERITIES,
  gatedReviewPosted,
  isLive,
  reviewPosted,
} from "@/lib/api/types";
import type {
  CheckState,
  CheckTimings,
  Finding,
  ReviewTool,
  Run,
  RunDigest,
  RunSummary,
  SetupTimings,
  UsageTotals,
} from "@/lib/api/types";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_RUN_FIELDS,
  PUBLIC_SUMMARY_FIELDS,
} from "../../../../cujo/src/http/public/serialize";
import type {
  CheckTimings as CujoCheckTimings,
  SetupTimings as CujoSetupTimings,
} from "../../../../cujo/src/review/timings";
import { CHECK_NAMES as CUJO_CHECK_NAMES } from "../../../../cujo/src/review/types";
import type {
  CheckState as CujoCheckState,
  Finding as CujoFinding,
  RunDigest as CujoRunDigest,
  UsageTotals as CujoUsageTotals,
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
      // What the check cost and where its wall time went (commit 513d35f).
      // Stated here so a key renamed in apps/cujo stops this compiling rather
      // than quietly rendering `undefined` on the run page.
      usage: {
        inputTokens: 1_200,
        outputTokens: 340,
        cacheReadTokens: 8_000,
        cacheWriteTokens: 0,
        messages: 6,
      },
      timings: { wallMs: 61_000, sandboxMs: 41_000, modelMs: 20_000 },
    };
    // `threadId` is restated rather than spread: it is optional on this side
    // because the public plane withholds it, and required on cujo's, where
    // every check has one (decision 34).
    //
    // `usage` and `timings` are restated for a different reason, and the
    // difference is the point. In `apps/cujo` they are optional and never
    // null — a check that reported none simply has no key. On the wire
    // `publicCheck` emits `?? null`, so a reader here meets null and has to
    // hold both. Mapping null back to undefined is what states that.
    const asCujo: CujoCheckState = {
      ...check,
      threadId: check.threadId ?? "t",
      startedAt: null,
      endedAt: null,
      usage: check.usage ?? undefined,
      timings: check.timings ?? undefined,
    };
    expect(asCujo.title).toBe("tests");
    expect(asCujo.timings?.sandboxMs).toBe(41_000);

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

/** Every field a list row carries except `status`, which each case supplies. */
const summaryBase: RunSummary = {
  id: "r1",
  repo: "o/r",
  pr_number: 7,
  head_sha: "abc1234",
  status: "clean",
  created_at: "2026-08-28T10:00:00Z",
  updated_at: "2026-08-28T10:00:00Z",
  pr_title: "Add a thing",
};

/** Every field a Run carries except `status`, which each case supplies. */
const base = {
  id: "r1",
  repo: "o/r",
  pr_number: 7,
  head_sha: "abc1234",
  session_id: "s",
  turn_ids: [],
  pr_title: "Add a thing",
  pr_author_login: "octocat",
  pr_author_id: 583231,
  created_at: "2026-08-28T10:00:00Z",
  updated_at: "2026-08-28T10:00:00Z",
  checks: [],
  findings: [],
  hard_rule_hits: [],
  review: null,
  external_resume: false,
  error: null,
  summary: null,
};

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
 * One plane since decision 57, so this is stricter than it was: the fields the
 * serializer withholds are absent from these types rather than optional on
 * them. A field added on either side without the other fails here.
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
    // What the pull request says about itself: already world-readable on
    // GitHub for every repo this plane serves (decision 55).
    "pr_title",
  ];

  /**
   * On the list only (decision 65). The detail route serves `checks` and
   * `findings` in full, so a reduction of them there would be a second copy of
   * the same fact — and `checks` already means the array on that shape.
   */
  const SUMMARY_ONLY = ["digest"];

  it("keeps the summary shape to what a public list can carry", () => {
    expect([...PUBLIC_SUMMARY_FIELDS].sort()).toEqual(
      [...REQUIRED_ON_BOTH_PLANES, ...SUMMARY_ONLY].sort(),
    );
  });

  it("reduces the checks for a list row, and never for a run page", () => {
    expect(PUBLIC_SUMMARY_FIELDS).toContain("digest");
    expect(PUBLIC_RUN_FIELDS).not.toContain("digest");
  });

  /**
   * Layer 1 for the digest on this side: the mirror is hand-written, so a key
   * renamed in `apps/cujo` has to stop this assignment compiling rather than
   * quietly become `undefined` at runtime.
   */
  it("type-checks a digest as apps/cujo emits it", () => {
    const digest: RunDigest = {
      checks: { tests: { status: "done", ms: 41_230 }, detonation: { status: "error", ms: null } },
      findings: { critical: 1, warn: 2, info: 0 },
      durationMs: 132_400,
    };
    const asCujo: CujoRunDigest = digest;
    expect(asCujo.checks.tests?.ms).toBe(41_230);
    // A run claimed but never folded carries no digest at all, which every
    // reader has to tell apart from four checks that reported nothing.
    const unfolded: RunSummary = { ...summaryBase, digest: null };
    expect(unfolded.digest).toBeNull();
  });

  it("never publishes a field that names a person or the state of the gate", () => {
    for (const field of ["approver", "decided_at", "approval", "decision", "is_public"]) {
      expect(PUBLIC_RUN_FIELDS).not.toContain(field);
      expect(PUBLIC_SUMMARY_FIELDS).not.toContain(field);
    }
  });

  it("publishes the harness and GitHub handles on the detail, never on the list", () => {
    // Decision 57 moved these into the public projection. The list stays as
    // narrow as it was: a board of every run is not the place for them.
    for (const field of ["session_id", "turn_ids", "external_resume", "delivery_id"]) {
      expect(PUBLIC_RUN_FIELDS).toContain(field);
      expect(PUBLIC_SUMMARY_FIELDS).not.toContain(field);
    }
  });

  /**
   * What the run cost and what produced it: also detail-only, for the same
   * reason. The list already carries a reduction of the checks (decision 65),
   * and a board of every run is not the place for a token count.
   */
  it("publishes cost and provenance on the detail, never on the list", () => {
    for (const field of ["usage", "model", "rubric_sha256"]) {
      expect(PUBLIC_RUN_FIELDS).toContain(field);
      expect(PUBLIC_SUMMARY_FIELDS).not.toContain(field);
    }
  });

  /**
   * The same hand-written-mirror guard the digest gets, for the two shapes the
   * run page reads. A key renamed in `apps/cujo` has to stop this assignment
   * compiling rather than become `undefined` at runtime.
   */
  it("type-checks usage and timings as apps/cujo emits them", () => {
    const usage: UsageTotals = {
      inputTokens: 41_000,
      outputTokens: 2_100,
      cacheReadTokens: 380_000,
      cacheWriteTokens: 12_000,
      reasoningTokens: 900,
      costUsd: 0.37,
      messages: 24,
    };
    const asCujoUsage: CujoUsageTotals = usage;
    expect(asCujoUsage.costUsd).toBe(0.37);

    // Every key optional: `apps/cujo` omits `modelMs` rather than publishing a
    // negative remainder, and omits the whole object when nothing timed.
    const timings: CheckTimings = { wallMs: 61_000 };
    const asCujoTimings: CujoCheckTimings = timings;
    expect(asCujoTimings.sandboxMs).toBeUndefined();
  });

  /**
   * The other direction: a public payload has to satisfy `Run`, or the shared
   * components could not render it. This compiles only while every field the
   * public plane omits is optional in `types.ts`.
   */
  it("type-checks a board payload as a Run", () => {
    const publicRun: Run = {
      id: "r1",
      repo: "o/r",
      pr_number: 7,
      head_sha: "abc1234",
      status: "blocked_pending",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:01:00.000Z",
      pr_title: "Add a thing",
      pr_author_login: "octocat",
      pr_author_id: 583231,
      checks: [],
      findings: [],
      hard_rule_hits: [],
      review: null,
      error: null,
      summary: null,
    };
    // The stronger statement, now that there is nowhere else a payload could
    // come from: the type has no key for the fields the serializer withholds,
    // so a component cannot read one even by accident.
    expect(Object.keys(publicRun)).not.toContain("approver");
    expect("approval" in publicRun).toBe(false);
  });

  it("carries every emitted key the shared components read", () => {
    for (const field of [...REQUIRED_ON_BOTH_PLANES, "checks", "findings", "review", "summary"]) {
      expect(PUBLIC_RUN_FIELDS).toContain(field);
    }
  });

  /**
   * The author is on the run and not on the summary, so the run page can name
   * a person and a list row cannot. Asserted rather than assumed: the two
   * lists are edited in different places and would otherwise drift.
   */
  it("names the author on a run but never on a list row", () => {
    for (const field of ["pr_author_login", "pr_author_id"]) {
      expect(PUBLIC_RUN_FIELDS).toContain(field);
      expect(PUBLIC_SUMMARY_FIELDS).not.toContain(field);
    }
  });

  /**
   * Every published field is typed here, and every typed field is published.
   *
   * The tests above name fields one at a time, which catches a field somebody
   * thought about and misses the one nobody did — `setup` was published by
   * decision 67 and went five releases without a key in `types.ts`, on a green
   * build, because no assertion here was about the *set*.
   *
   * `apps/cujo` has the mirror of this guard already: `serialize.test.ts` makes
   * a new key of `Projection` a red build until it is classified as published
   * or withheld. This is the other half — a field it decides to publish is a
   * red build here until `apps/web` decides what to do with it. A field the UI
   * deliberately does not render is still typed; that is a rendering decision,
   * and it belongs in a component rather than in a hole in the wire shape.
   *
   * `Record<keyof T, true>` is what makes the compiler do the work: a key added
   * to `Run` stops the literal compiling until it is listed, and a key the
   * serializer adds fails the comparison until it reaches the interface.
   */
  const DETAIL_KEYS: Record<Exclude<keyof Run, "digest">, true> = {
    id: true,
    repo: true,
    pr_number: true,
    head_sha: true,
    status: true,
    created_at: true,
    updated_at: true,
    pr_title: true,
    pr_author_login: true,
    pr_author_id: true,
    session_id: true,
    turn_ids: true,
    external_resume: true,
    delivery_id: true,
    checks: true,
    findings: true,
    hard_rule_hits: true,
    review: true,
    gated_review: true,
    error: true,
    summary: true,
    usage: true,
    model: true,
    rubric_sha256: true,
    setup: true,
  };

  const SUMMARY_KEYS: Record<keyof RunSummary, true> = {
    id: true,
    repo: true,
    pr_number: true,
    head_sha: true,
    status: true,
    created_at: true,
    updated_at: true,
    pr_title: true,
    digest: true,
  };

  /**
   * `digest` is the one exclusion, and it is not a hole. `Run extends
   * RunSummary` because a `run` frame on the stream reuses the interface, so
   * the detail shape inherits the key — but `serializePublicRun` never emits
   * it, which the test above asserts directly. Excluding it here says the same
   * thing a third way rather than leaving the set unstated.
   */
  it("types every field the detail route publishes, and publishes every one it types", () => {
    expect(Object.keys(DETAIL_KEYS).sort()).toEqual([...PUBLIC_RUN_FIELDS].sort());
  });

  it("types every field a list row publishes, and publishes every one it types", () => {
    expect(Object.keys(SUMMARY_KEYS).sort()).toEqual([...PUBLIC_SUMMARY_FIELDS].sort());
  });

  /**
   * The hand-written-mirror guard for the setup window, the same one `usage`
   * and `timings` get above. Four stamps and a count; `ms` is optional because
   * `settleSetup` fills it only when both its ends are usable.
   */
  it("type-checks the setup window as apps/cujo emits it", () => {
    const setup: SetupTimings = {
      turnCreatedAt: "2026-08-28T10:00:00.000Z",
      sandboxCreatedAt: "2026-08-28T10:00:40.000Z",
      agentStartedAt: "2026-08-28T10:00:45.000Z",
      firstCheckAt: "2026-08-28T10:01:40.000Z",
      messages: 6,
      ms: 55_000,
    };
    const asCujo: CujoSetupTimings = setup;
    expect(asCujo.ms).toBe(55_000);

    // Null is a fact and not a gap: `sandbox.created` is session-scoped, so a
    // second run on the same pull request never sees one.
    const rerun: SetupTimings = { ...setup, sandboxCreatedAt: null };
    expect(rerun.sandboxCreatedAt).toBeNull();
  });
});
