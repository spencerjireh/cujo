import type { CheckState, DraftedReview, Finding, Run, RunDigest, RunSummary } from "./api/types";

/**
 * The three demo runs from docs/demo.md, plus the states that are awkward to
 * reproduce against a live stack. Stories build on these so a reviewer sees the
 * same evidence the video does.
 */

const T0 = "2026-08-28T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

export function check(over: Partial<CheckState> & { title: string }): CheckState {
  return {
    threadId: `thread-${over.title}`,
    isCheck: true,
    status: "done",
    report: null,
    error: null,
    startedAt: at(0),
    endedAt: at(60),
    ...over,
  };
}

export const cleanChecks: CheckState[] = [
  check({ title: "tests", startedAt: at(2), endedAt: at(110) }),
  check({ title: "probes", startedAt: at(4), endedAt: at(56) }),
  check({ title: "smoke", startedAt: at(6), endedAt: at(76) }),
];

export const detonationChecks: CheckState[] = [
  // Four different sandbox shares, because the timeline draws that split and a
  // fixture where every lane divides identically proves nothing about it.
  // `tests` spends most of its wall clock executing; `probes` almost none.
  check({
    title: "tests",
    startedAt: at(2),
    endedAt: at(110),
    usage: {
      inputTokens: 18_400,
      outputTokens: 1_900,
      cacheReadTokens: 142_000,
      cacheWriteTokens: 9_100,
      messages: 8,
      costUsd: 0.0912,
    },
    timings: { wallMs: 108_000, sandboxMs: 81_000, modelMs: 27_000 },
  }),
  check({
    title: "probes",
    startedAt: at(4),
    endedAt: at(56),
    usage: {
      inputTokens: 9_200,
      outputTokens: 840,
      cacheReadTokens: 61_000,
      cacheWriteTokens: 0,
      messages: 5,
      costUsd: 0.0311,
    },
    timings: { wallMs: 52_000, sandboxMs: 7_000, modelMs: 45_000 },
  }),
  // No `timings` at all: a check from before the field existed, which the
  // timeline has to draw as one undivided lane rather than as all-model.
  check({ title: "smoke", startedAt: at(6), endedAt: at(76) }),
  check({
    title: "detonation",
    startedAt: at(8),
    endedAt: at(158),
    usage: {
      inputTokens: 24_600,
      outputTokens: 3_400,
      cacheReadTokens: 210_000,
      cacheWriteTokens: 14_000,
      reasoningTokens: 1_200,
      messages: 11,
      costUsd: 0.1544,
    },
    timings: { wallMs: 150_000, sandboxMs: 118_000, modelMs: 32_000 },
    report: {
      runs: [
        {
          dependency: "tainted-sample==1.0.0",
          egress: [
            { host: "185.220.101.4", port: 443, bytes: 3200, known: false },
            { host: "pypi.org", port: 443, bytes: 11_000, known: true },
          ],
          files_read: [{ path: "~/.aws/credentials", sensitive: true }],
          fs_changes: [{ path: "/tmp/.x", type: "created", in_workspace: false }],
          subprocesses: [{ argv: ["pip", "install", "tainted-sample==1.0.0"], exit: 0 }],
          secret_probe: { decoy_read: true, decoy_in_egress: true },
          derived: {
            egress_to_unknown_host: true,
            wrote_outside_workspace: true,
            wrote_sensitive: false,
            spawned_subprocess: true,
          },
        },
      ],
    },
  }),
];

export const runningChecks: CheckState[] = [
  check({ title: "tests", status: "running", startedAt: at(2), endedAt: null }),
  check({ title: "probes", startedAt: at(4), endedAt: at(56) }),
  check({ title: "smoke", status: "running", startedAt: at(6), endedAt: null }),
];

export const findings: Finding[] = [
  {
    source: "hard_rule",
    check: "detonation",
    severity: "critical",
    title: "an install contacted a host that is neither a package index nor allowlisted",
    evidence: "egress: 185.220.101.4",
  },
  {
    source: "hard_rule",
    check: "tests",
    severity: "critical",
    title: "3 tests pass on base and fail on head",
    evidence: "orders.test.ts:41, orders.test.ts:58, orders.test.ts:77",
  },
  {
    source: "agent",
    check: "smoke",
    severity: "warn",
    title: "the smoke check returned no report",
    evidence: "",
  },
  {
    source: "agent",
    check: "review",
    severity: "info",
    title: "boot returned 200 on /healthz in 1.8 s",
    evidence: "",
    path: "app/pricing.py",
    line: 28,
  },
];

/**
 * The digest of the detonation run: four checks that all reported, and the
 * findings above counted by severity. Written out rather than derived from
 * `detonationChecks`, because a fixture that computes its own expected value
 * proves nothing about the shape it is standing in for.
 */
export const detonationDigest: RunDigest = {
  checks: {
    tests: { status: "done", ms: 108_000 },
    probes: { status: "done", ms: 52_000 },
    smoke: { status: "done", ms: 70_000 },
    detonation: { status: "done", ms: 150_000 },
  },
  findings: { critical: 2, warn: 1, info: 1 },
  durationMs: 156_000,
};

export const summary: RunSummary = {
  id: "run-1",
  repo: "spencerjireh/orders-api",
  pr_number: 42,
  head_sha: "a1f9c3e4d5b6c7",
  status: "blocked_pending",
  pr_title: "Add a refund endpoint",
  created_at: T0,
  updated_at: at(160),
  digest: detonationDigest,
};

/** Non-nullable, so stories can build on it without asserting it exists. */
export function review(over: Partial<DraftedReview> = {}): DraftedReview {
  return {
    tool: "post_blocking_review",
    toolCallId: "call-1",
    body: [
      "Ran tests, probes, a smoke boot, and dependency detonation on `a1f9c3e`.",
      "",
      "- `tainted-sample@1.0.0` opened a socket to `185.220.101.4:443` during install.",
      "- 3 tests pass on base and fail on head.",
      "",
      "The install-time egress is the blocking one.",
    ].join("\n"),
    comments: [
      {
        path: "app/pricing.py",
        line: 28,
        side: "RIGHT",
        body: "This rounds before applying the discount, which flips the two failing cases.",
      },
    ],
    findings: [],
    ...over,
  };
}

export function run(over: Partial<Run> = {}): Run {
  return {
    ...summary,
    session_id: "sess-1",
    turn_ids: ["turn-1"],
    delivery_id: "d-1",
    pr_author_login: "octocat",
    pr_author_id: 583231,
    checks: detonationChecks,
    findings,
    hard_rule_hits: findings.filter((f) => f.source === "hard_rule"),
    review: review(),
    external_resume: false,
    error: null,
    summary: "Four checks ran. Two hard rules tripped, so the review blocks the merge.",
    // Larger than the four checks add up to, which is the honest shape: the
    // run total is summed over every turn, and the turn that folded the
    // reports and drafted the review is not one of the checks.
    usage: {
      inputTokens: 61_800,
      outputTokens: 8_140,
      cacheReadTokens: 486_000,
      cacheWriteTokens: 27_400,
      reasoningTokens: 1_200,
      messages: 31,
      costUsd: 0.3418,
    },
    model: "claude-sonnet-5",
    rubric_sha256: "9f2c41ba7d6e5308c1aa4bf0d2e79c3518ab6e40f7c92d15b8ae3c6104d7f2b9",
    ...over,
  };
}

/**
 * Five rows spanning every digest a board row can meet: four checks that all
 * reported, a clean sweep, a run whose detonation errored, a run still going,
 * and one with no digest at all.
 */
export const runs: RunSummary[] = [
  summary,
  {
    ...summary,
    id: "run-2",
    pr_number: 41,
    pr_title: "Bump requests to 2.32.3",
    head_sha: "b2e8d4f",
    status: "clean",
    updated_at: at(-3_600),
    digest: {
      checks: {
        tests: { status: "done", ms: 41_000 },
        probes: { status: "done", ms: 22_000 },
        smoke: { status: "done", ms: 31_000 },
        detonation: { status: "done", ms: 48_000 },
      },
      findings: { critical: 0, warn: 0, info: 1 },
      durationMs: 52_000,
    },
  },
  {
    ...summary,
    id: "run-3",
    pr_number: 40,
    pr_title: "Add a currency field to the order payload",
    head_sha: "c3d7e5a",
    status: "blocked_posted",
    updated_at: at(-7_200),
    digest: {
      // A check that errored, and one that never appeared at all — the two
      // cases a sensor strip has to draw differently.
      checks: {
        tests: { status: "done", ms: 96_000 },
        probes: { status: "done", ms: 34_000 },
        detonation: { status: "error", ms: null },
      },
      findings: { critical: 1, warn: 0, info: 0 },
      durationMs: 101_000,
    },
  },
  {
    ...summary,
    id: "run-4",
    pr_number: 39,
    pr_title: "Cache the exchange-rate lookup",
    head_sha: "d4c6f2b",
    status: "running",
    updated_at: at(-30),
    digest: {
      // Mid-flight: no duration, because a partial envelope would read as a
      // run that finished fast.
      checks: {
        tests: { status: "running", ms: null },
        probes: { status: "done", ms: 19_000 },
        smoke: { status: "running", ms: null },
      },
      findings: { critical: 0, warn: 0, info: 0 },
      durationMs: null,
    },
  },
  {
    ...summary,
    id: "run-5",
    pr_number: 38,
    // A run claimed before titles were stored: the row falls back to repo #N.
    pr_title: null,
    head_sha: "e5b5a1c",
    status: "superseded",
    updated_at: at(-10_800),
    // Claimed but never folded, so there is nothing to reduce. Not four zeroed
    // checks — the board must not draw this as a run that passed.
    digest: null,
  },
];
