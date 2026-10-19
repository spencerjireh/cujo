import type { CheckState, DraftedReview, Finding, Run, RunDigest, RunSummary } from "./api/types";

/**
 * The three demo runs, plus the states that are awkward to
 * reproduce against a live stack. Stories build on these so a reviewer sees the
 * same evidence the live board does.
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
    report: {
      command: "pnpm test",
      base: { passed: 212, failed: 0 },
      head: { passed: 209, failed: 3 },
      base_pass_head_fail: ["orders.test.ts:41", "orders.test.ts:58", "orders.test.ts:77"],
    },
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
    report: {
      probes: [{ name: "refund rounds to the cent", passed: true }],
    },
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

/**
 * What the server's fold makes of `detonationChecks` (apps/cujo
 * `review/findings.ts`): one critical finding per hard rule each report
 * trips, a `check_missing` warning for the check that reported nothing, and
 * one note from the model.
 */
export const findings: Finding[] = [
  {
    source: "hard_rule",
    rule: "tests_failed",
    check: "tests",
    severity: "critical",
    title: "3 tests pass on base and fail on head",
    evidence: "orders.test.ts:41, orders.test.ts:58, orders.test.ts:77",
  },
  {
    source: "hard_rule",
    rule: "decoy_read",
    check: "detonation",
    severity: "critical",
    title: "the seeded decoy secret was read during detonation",
    evidence: "secret_probe.decoy_read = true",
  },
  {
    source: "hard_rule",
    rule: "decoy_in_egress",
    check: "detonation",
    severity: "critical",
    title: "the seeded decoy secret left the sandbox during detonation",
    evidence: "secret_probe.decoy_in_egress = true",
  },
  {
    source: "hard_rule",
    rule: "egress_to_unknown_host",
    check: "detonation",
    severity: "critical",
    title: "an install contacted a host that is neither a package index nor allowlisted",
    evidence: "egress: 185.220.101.4",
  },
  {
    source: "hard_rule",
    rule: "check_missing",
    check: "smoke",
    severity: "warn",
    title: "the smoke check returned no report",
    evidence: "the thread ended without a report",
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
const detonationDigest: RunDigest = {
  checks: {
    // Four different execution shares, matching `detonationChecks` above,
    // because the specimen draws that split as the solid part of an arm and a
    // fixture where every lane divides identically proves nothing about it.
    // `smoke` has none at all — a check from before `timings` existed, drawn as
    // one undivided arm rather than as all-model.
    tests: { status: "done", ms: 108_000, sandboxMs: 81_000 },
    probes: { status: "done", ms: 52_000, sandboxMs: 7_000 },
    smoke: { status: "done", ms: 70_000, sandboxMs: null },
    detonation: { status: "done", ms: 150_000, sandboxMs: 118_000 },
  },
  findings: { critical: 4, warn: 1, info: 1 },
  durationMs: 156_000,
};

const summary: RunSummary = {
  id: "run-1",
  repo: "spencerjireh/orders-api",
  pr_number: 42,
  head_sha: "a1f9c3e4d5b6c7",
  status: "blocked",
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
    error: null,
    summary: "Four checks ran. Four hard rules tripped, so the review blocks the merge.",
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
    mode: "sandbox",
    budget_tokens: null,
    // Before T0, because setup is the window *before* the first check and the
    // four lanes above start two seconds in. The proportions are decision 67's
    // own PR 17 reading — 84 seconds from the turn to the first check, most of
    // it provisioning — so the timeline is drawn against a shape that actually
    // occurred rather than one chosen to look balanced.
    setup: {
      turnCreatedAt: at(-84),
      sandboxCreatedAt: at(-40),
      agentStartedAt: at(-30),
      firstCheckAt: at(2),
      messages: 5,
      ms: 32_000,
    },
    // The parent first, then the checks in spawn order, with the parent the
    // largest row: on a real run it holds the rubric, the brief and every
    // report, and re-reads them on each of its messages (decision 141). The
    // check rows agree with the per-check `usage` above.
    ledger: {
      threads: [
        {
          title: "main",
          attempt: 1,
          messages: 14,
          inputTokens: 9_600,
          outputTokens: 2_000,
          cacheReadTokens: 73_000,
          cacheWriteTokens: 4_300,
          reasoningTokens: null,
          toolResultBytes: 61_440,
        },
        {
          title: "tests",
          attempt: 1,
          messages: 8,
          inputTokens: 18_400,
          outputTokens: 1_900,
          cacheReadTokens: 142_000,
          cacheWriteTokens: 9_100,
          reasoningTokens: null,
          toolResultBytes: 48_128,
        },
        {
          title: "probes",
          attempt: 1,
          messages: 5,
          inputTokens: 9_200,
          outputTokens: 840,
          cacheReadTokens: 61_000,
          cacheWriteTokens: 0,
          reasoningTokens: null,
          toolResultBytes: 12_288,
        },
        {
          title: "smoke",
          attempt: 1,
          messages: 4,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: null,
          toolResultBytes: 6_144,
        },
        {
          title: "detonation",
          attempt: 1,
          messages: 0,
          inputTokens: 24_600,
          outputTokens: 3_400,
          cacheReadTokens: 210_000,
          cacheWriteTokens: 14_000,
          reasoningTokens: 1_200,
          toolResultBytes: 30_720,
        },
      ],
      largestToolResults: [
        { thread: "tests", tool: "sandbox_exec", bytes: 31_744, isError: false },
        { thread: "main", tool: "create_sub_agent", bytes: 22_528, isError: false },
        { thread: "detonation", tool: "sandbox_exec", bytes: 19_456, isError: false },
        { thread: "main", tool: "create_sub_agent", bytes: 14_336, isError: false },
        { thread: "tests", tool: "sandbox_exec", bytes: 9_216, isError: true },
        { thread: "probes", tool: "sandbox_read_file", bytes: 8_192, isError: false },
      ],
    },
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
        tests: { status: "done", ms: 41_000, sandboxMs: null },
        probes: { status: "done", ms: 22_000, sandboxMs: null },
        smoke: { status: "done", ms: 31_000, sandboxMs: null },
        detonation: { status: "done", ms: 48_000, sandboxMs: null },
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
    status: "blocked",
    updated_at: at(-7_200),
    digest: {
      // A check that errored, and one that never appeared at all — the two
      // cases a sensor strip has to draw differently.
      checks: {
        tests: { status: "done", ms: 96_000, sandboxMs: null },
        probes: { status: "done", ms: 34_000, sandboxMs: null },
        detonation: { status: "error", ms: null, sandboxMs: null },
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
        tests: { status: "running", ms: null, sandboxMs: null },
        probes: { status: "done", ms: 19_000, sandboxMs: null },
        smoke: { status: "running", ms: null, sandboxMs: null },
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

/**
 * An owner's runs across three repositories (decision 175): the board's five,
 * plus every status an owner's activity has to word — an error that needs a
 * re-run, a lifted block, an unproven review — and a pull request whose older
 * run was blocked and whose newer one is clean, so "blocked now" has to read
 * the newest run and not any run.
 */
export const ownerRuns: RunSummary[] = [
  {
    ...summary,
    id: "run-10",
    repo: "spencerjireh/notes",
    pr_number: 7,
    pr_title: "Sync notes over WebDAV",
    head_sha: "f1a2b3c",
    status: "error",
    created_at: at(600),
    updated_at: at(640),
    digest: null,
  },
  {
    ...summary,
    id: "run-11",
    repo: "spencerjireh/cujo",
    pr_number: 210,
    pr_title: "Tighten the egress allowlist",
    head_sha: "a9b8c7d",
    status: "clean",
    created_at: at(500),
    updated_at: at(560),
    digest: { ...detonationDigest, findings: { critical: 0, warn: 1, info: 2 } },
  },
  {
    ...summary,
    id: "run-12",
    repo: "spencerjireh/cujo",
    pr_number: 210,
    pr_title: "Tighten the egress allowlist",
    head_sha: "0d1e2f3",
    status: "blocked",
    created_at: at(400),
    updated_at: at(450),
  },
  {
    ...summary,
    id: "run-13",
    repo: "spencerjireh/cujo",
    pr_number: 208,
    pr_title: "Retry the check run on a 502",
    head_sha: "4a5b6c7",
    status: "dismissed",
    created_at: at(300),
    updated_at: at(390),
  },
  {
    ...summary,
    id: "run-14",
    repo: "spencerjireh/notes",
    pr_number: 6,
    pr_title: "Add a search index",
    head_sha: "8d9e0f1",
    status: "unproven",
    mode: "diff",
    created_at: at(200),
    updated_at: at(230),
    digest: { checks: {}, findings: { critical: 0, warn: 0, info: 1 }, durationMs: 30_000 },
  },
  ...runs,
];
