import type { CheckState, DraftedReview, Finding, Run, RunSummary } from "./api/types";

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
  check({ title: "tests", startedAt: at(2), endedAt: at(110) }),
  check({ title: "probes", startedAt: at(4), endedAt: at(56) }),
  check({ title: "smoke", startedAt: at(6), endedAt: at(76) }),
  check({
    title: "detonation",
    startedAt: at(8),
    endedAt: at(158),
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

export const summary: RunSummary = {
  id: "run-1",
  repo: "spencerjireh/orders-api",
  pr_number: 42,
  head_sha: "a1f9c3e4d5b6c7",
  status: "blocked_pending",
  approver: null,
  pr_title: "Add a refund endpoint",
  created_at: T0,
  updated_at: at(160),
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
    decided_at: null,
    pr_author_login: "octocat",
    pr_author_id: 583231,
    checks: detonationChecks,
    findings,
    hard_rule_hits: findings.filter((f) => f.source === "hard_rule"),
    review: review(),
    approval: { threadId: "main", toolCallId: "call-1", sourceEventId: "event-1" },
    external_resume: false,
    error: null,
    summary: "Four checks ran. Two hard rules tripped, so the review blocks the merge.",
    ...over,
  };
}

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
  },
  {
    ...summary,
    id: "run-3",
    pr_number: 40,
    pr_title: "Add a currency field to the order payload",
    head_sha: "c3d7e5a",
    status: "blocked_posted",
    approver: "op@example.com",
    updated_at: at(-7_200),
  },
  {
    ...summary,
    id: "run-4",
    pr_number: 39,
    pr_title: "Cache the exchange-rate lookup",
    head_sha: "d4c6f2b",
    status: "running",
    updated_at: at(-30),
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
  },
];
