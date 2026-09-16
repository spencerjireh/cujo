import type {
  ModelMessageUsage,
  SessionEvent,
  ToolCall,
  TurnDoneEvent,
  TurnInputItem,
  TurnMetrics,
  TurnStateDone,
} from "@cujo/harness-contract";
import { renderReviewBody, reviewComments } from "@cujo/review-render";
import { describe, expect, it } from "vitest";
import { isMaliceClaim } from "../../src/review/findings";
import { executedThreadId, fold, parseReport, parseReview } from "../../src/review/fold";

type Ev = SessionEvent;
const at = "2026-08-27T00:00:00Z";

const turnCreated = (turnId: string, input?: TurnInputItem[], createdAt: string = at): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: "main",
  turnId,
  previousTurnId: null,
  input: input ?? [],
});

/** A parent turn with no tool call: one round trip, and nothing else. */
const mainMessage = (id: string, createdAt: string): Ev => ({
  type: "model.message",
  id,
  createdAt,
  threadId: "main",
  content: "",
});

const turnDone = (state: TurnDoneEvent["state"] = doneState()): Ev => ({
  type: "turn.done",
  id: "td",
  createdAt: at,
  threadId: "main",
  state,
});

function doneState(): TurnStateDone {
  return { status: "done", completedAt: at, output: null, requiredActions: [] };
}

const reviewCall = (id: string, name: string, args: unknown): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: at,
  threadId: "main",
  content: null,
  toolCalls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
      toolInfo: { type: "mcp", name, serverName: "github-mcp" },
    },
  ],
});

const approvalRequired = (threadId: string, callId: string, sourceEventId: string): Ev => ({
  type: "tool.approval_required",
  id: "ar",
  createdAt: at,
  threadId,
  toolCalls: [{ id: callId, sourceEventId }],
});

/** A sub-agent that ended without a report, which is what a provider fault looks like. */
const threadErrored = (threadId: string, message: string, createdAt: string = at): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt,
  threadId,
  title: threadId,
  parent: { threadId: "main", toolCallId: "spawn" },
  state: { status: "error", error: message },
});

const toolResponse = (
  toolCallId: string,
  toolName = "post_blocking_review",
  isError = false,
): Ev => ({
  type: "tool.response",
  id: `tr-${toolCallId}`,
  createdAt: at,
  threadId: "main",
  toolCallId,
  toolName,
  content: "{}",
  isError,
});

const threadCreated = (threadId: string, title: string, createdAt: string = at): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: { type: "dynamic", name: title, input: "" },
});

const threadDone = (threadId: string, text: string, createdAt: string = at): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt,
  threadId,
  title: threadId,
  parent: { threadId: "main", toolCallId: "spawn" },
  state: {
    status: "done",
    output: { type: "model.message", id: "out", createdAt: at, threadId, content: text },
  },
});

// A call from a session pinned to the old rubric: it still sends `comments[]`,
// and `parseReview` still reads it (decision 74).
const review = { body: "What ran", comments: [{ path: "a.py", line: 3, body: "boom" }] };
// What the rubric sends now: anchors ride on the findings, nothing else.
const derivedReview = {
  body: "A test that passed on base fails on head.",
  findings: [
    {
      check: "tests",
      severity: "critical",
      title: "1 test passes on base and fails on head",
      evidence: "AssertionError: 10.05 != 10.04",
      path: "app/orders.py",
      line: 42,
    },
    { check: "probes", severity: "info", title: "the probes agreed", evidence: "3 of 3" },
  ],
};
describe("fold", () => {
  it("is running with no events and appends turn ids", () => {
    const p = fold([turnCreated("t1")]);
    expect(p.status).toBe("running");
    expect(p.turnIds).toEqual(["t1"]);
  });

  it("is clean when an advisory posts and a check reported", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", '```json\n{"check":"tests"}\n```'),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("clean");
    expect(p.review?.tool).toBe("post_advisory_review");
    expect(p.review?.comments).toHaveLength(1);
  });

  it("is unproven when a review posts and not one check reported", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    // The review is real and so is the absence of anything behind it. `clean`
    // was the opposite claim, and none of the four `check_missing` warns the
    // fold raised could move it, because no `warn` ever moves a status.
    expect(p.status).toBe("unproven");
    expect(p.review?.tool).toBe("post_advisory_review");
    // On `p.findings` and not `p.hardRuleHits`: `missingCheckFindings` is merged
    // at `turn.done` only, because until the turn ends a check is late and not
    // missing.
    // Three, not four: `REQUIRED_CHECKS` leaves detonation out, because it runs
    // on a changed manifest rather than on every pull request.
    expect(p.findings.filter((f) => f.rule === "check_missing")).toHaveLength(3);
    expect(p.findings.every((f) => f.severity !== "critical")).toBe(true);
  });

  it("is unproven when a check ran and errored without a report", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadErrored("th-tests", "429 rate limited"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    // A thread that existed is not evidence; a report is.
    expect(p.status).toBe("unproven");
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0]?.report).toBeNull();
  });

  it("is clean when only detonation reported, because no suite was inferred", () => {
    // Decision 87: the three suite checks are inapplicable rather than missing
    // when nothing inferred a test command, and detonation's report is evidence
    // like any other. Folding that to `unproven` would punish the one case the
    // rubric is explicitly allowed to take.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-det", "detonation"),
      threadDone("th-det", '```json\n{"check":"detonation"}\n```'),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("clean");
  });

  it("lets a contradiction outrank unproven, so a blocking review still says so", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_blocking_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    // No check reported here either, but a REQUEST_CHANGES is on the pull
    // request and that is the louder fact. The rung order is what guarantees it.
    expect(p.status).toBe("blocked");
  });

  describe("the report is the tool result (decision 147)", () => {
    const execResult = (threadId: string, id: string, stdout: string, exitCode = 0): Ev => ({
      type: "tool.response",
      id,
      createdAt: at,
      threadId,
      toolCallId: `call-${id}`,
      toolName: "sandbox_exec",
      content: JSON.stringify({
        ok: true,
        exit_code: exitCode,
        stdout,
        stderr: "",
        duration_ms: 3,
      }),
      isError: false,
    });
    const envelope = (check: string, mark: string) =>
      JSON.stringify({ schema_version: 1, check, runs: [{ mark }], derived: {} });

    it("reads a check's envelope off the sniff.py report result, whole", () => {
      const p = fold([
        turnCreated("t1"),
        threadCreated("th-tests", "tests"),
        execResult("th-tests", "r1", envelope("tests", "from the tool")),
        // The model's own copy stopped at its output limit: no fence closes.
        threadDone("th-tests", 'Ran the suite.\n```json\n{"check":"tests","runs":[{"mark":"cut'),
        turnDone(),
      ]);
      expect(p.checks[0]?.report).toEqual({
        schema_version: 1,
        check: "tests",
        runs: [{ mark: "from the tool" }],
        derived: {},
      });
    });

    it("prefers the tool result to a message that pasted a different copy", () => {
      const p = fold([
        turnCreated("t1"),
        threadCreated("th-tests", "tests"),
        execResult("th-tests", "r1", envelope("tests", "from the tool")),
        threadDone("th-tests", `\`\`\`json\n${envelope("tests", "retyped")}\n\`\`\``),
        turnDone(),
      ]);
      expect((p.checks[0]?.report as { runs: { mark: string }[] }).runs[0]?.mark).toBe(
        "from the tool",
      );
    });

    it("takes the last report command when the sub-agent ran it twice", () => {
      const p = fold([
        turnCreated("t1"),
        threadCreated("th-tests", "tests"),
        execResult("th-tests", "r1", envelope("tests", "first")),
        execResult("th-tests", "r2", envelope("tests", "second")),
        threadDone("th-tests", "done"),
        turnDone(),
      ]);
      expect((p.checks[0]?.report as { runs: { mark: string }[] }).runs[0]?.mark).toBe("second");
    });

    it("ignores a wrapped run's entry, a failed command, another check's envelope, and prose", () => {
      const p = fold([
        turnCreated("t1"),
        threadCreated("th-tests", "tests"),
        // A `sniff.py run` entry carries `check` but never `runs`.
        execResult("th-tests", "r1", JSON.stringify({ check: "tests", argv: ["pytest"], exit: 0 })),
        execResult("th-tests", "r2", envelope("tests", "failed"), 1),
        execResult("th-tests", "r3", envelope("probes", "other")),
        execResult("th-tests", "r4", "collected 8 items\n8 passed"),
        threadDone("th-tests", `\`\`\`json\n${envelope("tests", "pasted")}\n\`\`\``),
        turnDone(),
      ]);
      expect((p.checks[0]?.report as { runs: { mark: string }[] }).runs[0]?.mark).toBe("pasted");
    });
  });

  describe("a cached detonation is substituted for its stub (decision 148)", () => {
    const stored = {
      dependency: "Humanize==4.9.0",
      source: "pypi",
      install_ok: true,
      egress: [{ host: "pypi.org" }],
    };
    const cached = [
      {
        source: "pypi",
        specifier: "humanize==4.9.0",
        report: stored,
        cachedFromRun: "run-earlier",
        cachedAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const envelope = (runs: unknown[]) =>
      JSON.stringify({ schema_version: 1, check: "detonation", runs, derived: {} });
    const execResult = (stdout: string): Ev => ({
      type: "tool.response",
      id: "r1",
      createdAt: at,
      threadId: "th-det",
      toolCallId: "c1",
      toolName: "sandbox_exec",
      content: JSON.stringify({ ok: true, exit_code: 0, stdout, stderr: "", duration_ms: 1 }),
      isError: false,
    });

    it("puts the stored entry where the stub was, marked with where it came from", () => {
      const p = fold(
        [
          turnCreated("t1"),
          threadCreated("th-det", "detonation"),
          execResult(
            envelope([
              // The sub-agent's own spelling of the key is normalised to match.
              { schema_version: 1, dependency: "humanize == 4.9.0", source: "pypi", cached: true },
              { dependency: "rich==13.0.0", source: "pypi", install_ok: true },
            ]),
          ),
          threadDone("th-det", "done"),
          turnDone(),
        ],
        { cachedDetonations: cached },
      );
      const runs = (p.checks[0]?.report as { runs: Record<string, unknown>[] }).runs;
      expect(runs[0]).toEqual({
        ...stored,
        cached_from_run: "run-earlier",
        cached_at: "2026-09-10T00:00:00.000Z",
      });
      expect(runs[1]?.dependency).toBe("rich==13.0.0");
    });

    it("leaves a stub alone when the run was briefed with no entry for it", () => {
      const stub = { schema_version: 1, dependency: "left-pad@1.3.0", source: "npm", cached: true };
      const p = fold(
        [
          turnCreated("t1"),
          threadCreated("th-det", "detonation"),
          execResult(envelope([stub])),
          threadDone("th-det", "done"),
          turnDone(),
        ],
        { cachedDetonations: cached },
      );
      expect((p.checks[0]?.report as { runs: unknown[] }).runs[0]).toEqual(stub);
    });

    it("substitutes nothing on a check that is not detonation, or with no entries", () => {
      const stub = {
        schema_version: 1,
        dependency: "humanize==4.9.0",
        source: "pypi",
        cached: true,
      };
      const events: Ev[] = [
        turnCreated("t1"),
        threadCreated("th-det", "detonation"),
        execResult(envelope([stub])),
        threadDone("th-det", "done"),
        turnDone(),
      ];
      expect((fold(events).checks[0]?.report as { runs: unknown[] }).runs[0]).toEqual(stub);
    });
  });

  it("counts one attempt per check on the common path", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", '```json\n{"check":"tests"}\n```'),
    ]);
    expect(p.checks[0]?.attempts).toBe(1);
  });

  it("counts the second thread with a check's name as a second attempt", () => {
    // Decision 108: the rubric respawns a sub-agent that errored, and the count
    // is the only record that it did. Both threads stay in `checks`, because the
    // first one holds the fault the retry was for.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests-1", "tests"),
      threadErrored("th-tests-1", "429 rate limited"),
      threadCreated("th-tests-2", "tests"),
      threadDone("th-tests-2", '```json\n{"check":"tests"}\n```'),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.checks.map((c) => c.attempts)).toEqual([1, 2]);
    expect(p.checks[0]?.status).toBe("error");
    expect(p.checks[1]?.report).toEqual({ check: "tests" });
    // The retry answered, so `tests` is not missing and the run is not unproven.
    expect(p.findings.some((f) => f.rule === "check_missing" && f.check === "tests")).toBe(false);
    expect(p.status).toBe("clean");
  });

  it("still calls a check missing when both attempts failed", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests-1", "tests"),
      threadErrored("th-tests-1", "429 rate limited"),
      threadCreated("th-tests-2", "tests"),
      threadErrored("th-tests-2", "429 rate limited"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.checks.map((c) => c.attempts)).toEqual([1, 2]);
    expect(p.findings.some((f) => f.rule === "check_missing" && f.check === "tests")).toBe(true);
    expect(p.status).toBe("unproven");
  });

  it("derives the inline comments from a review that sent none", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", derivedReview),
      toolResponse("call-0"),
      turnDone(),
    ]);
    // One anchored finding, one without: only the anchored one is a comment.
    expect(p.review?.comments).toEqual([
      {
        path: "app/orders.py",
        line: 42,
        side: "RIGHT",
        body: "**critical \u2014 1 test passes on base and fails on head**\n\n> AssertionError: 10.05 != 10.04",
      },
    ]);
  });

  it("keeps the comments a legacy call sent, rather than deriving over them", () => {
    // The guarantee for every pull request whose session predates the rubric
    // change: its board page loses nothing.
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.review?.comments).toEqual([{ path: "a.py", line: 3, body: "boom" }]);
  });

  it("is error, not clean, when the turn ends without any review call", () => {
    const p = fold([turnCreated("t1"), turnDone()]);
    expect(p.status).toBe("error");
    expect(p.error).toBe("turn ended without a review");
  });

  it("records no review from a call GitHub refused, and ends error naming it (decision 140)", () => {
    // orders-api #44: the App had opened the pull request, so every
    // `post_blocking_review` came back 422 and nothing reached the PR. The
    // response is the record, not the call — a `blocked` here would fail the
    // check run over a review nobody can read.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", '```json\n{"check":"tests"}\n```'),
      reviewCall("call-0", "post_blocking_review", review),
      {
        ...toolResponse("call-0", "post_blocking_review", true),
        content: "GitHub 422: Review cannot be requested\n  at post()",
      } as Ev,
      turnDone(),
    ]);
    expect(p.review).toBeNull();
    expect(p.status).toBe("error");
    expect(p.error).toBe(
      "review post failed: post_blocking_review — GitHub 422: Review cannot be requested",
    );
  });

  it("records the call that posted when an earlier one was refused", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", '```json\n{"check":"tests"}\n```'),
      reviewCall("call-0", "post_blocking_review", review),
      toolResponse("call-0", "post_blocking_review", true),
      reviewCall("call-1", "post_blocking_review", review),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(p.review?.tool).toBe("post_blocking_review");
    expect(p.status).toBe("blocked");
    expect(p.error).toBeNull();
  });

  it("records no review from a call with no response, since the turn died mid-call", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", review),
      turnDone(),
    ]);
    expect(p.review).toBeNull();
    expect(p.status).toBe("error");
    expect(p.error).toBe("turn ended without a review");
  });

  it("is an error when a tool call is held, since nothing is gated (decision 138)", () => {
    // A session pinned to an older spec still gates a name. The turn is
    // suspended waiting for an answer nothing will send, so the run ends here
    // rather than sitting `running` until the watchdog, and names the call.
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-1", "post_blocking_review", review),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toBe(
      "approval requested for post_blocking_review; nothing is gated on this spec",
    );
  });

  it("is error on a turn error", () => {
    const p = fold([
      turnCreated("t1"),
      turnDone({ status: "error", message: "model down", completedAt: at }),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toBe("model down");
  });

  it("is the same error for a held call on a subagent thread", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      approvalRequired("sub-1", "call-9", "nope"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toContain("approval requested");
  });

  it("maps check threads by title and parses the fenced report", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      threadCreated("sub-2", "helper"),
      threadDone("sub-1", 'Done.\n```json\n{"check":"tests","base_pass_head_fail":["t_a"]}\n```'),
    ]);
    expect(p.checks).toHaveLength(2);
    expect(p.checks[0]).toMatchObject({ title: "tests", isCheck: true, status: "done" });
    expect(p.checks[0]?.report).toEqual({ check: "tests", base_pass_head_fail: ["t_a"] });
    expect(p.checks[1]).toMatchObject({ title: "helper", isCheck: false, status: "running" });
  });
});

describe("hard rules in the fold", () => {
  const fenced = (report: unknown) => `\`\`\`json\n${JSON.stringify(report)}\n\`\`\``;

  /**
   * The three fields the rubric asks every envelope to carry, so a fixture here
   * is the shape of a report and not only the one field a test is about.
   *
   * Without this every fixture below would also raise a `report_invalid` warn,
   * which is a different test's subject and would bury the finding each of
   * these cases exists to assert.
   */
  const BASE = {
    runs: [],
    derived: {
      egress_to_unknown_host: false,
      wrote_outside_workspace: false,
      wrote_sensitive: false,
      spawned_subprocess: false,
    },
  };
  const report = (over: Record<string, unknown> = {}) =>
    fenced({
      ...BASE,
      ...over,
      derived: { ...BASE.derived, ...(over.derived as Record<string, boolean> | undefined) },
    });

  const tripped = report({ check: "tests", base_pass_head_fail: ["t_x"] });
  /** A malice rule, unlike `tripped`: an install called a host nobody allowed. */
  const detonated = report({
    check: "detonation",
    derived: { egress_to_unknown_host: true },
    egress: [{ host: "45.33.12.9", known: false }],
  });
  const accusation = {
    ...review,
    body: "the conclusion",
    findings: [
      {
        check: "detonation",
        severity: "critical",
        title: "the dependency is malware",
        evidence: "postinstall opened 45.33.12.9",
      },
    ],
  };
  const withFindings = {
    ...review,
    findings: [
      { check: "smoke", severity: "info", title: "boots", evidence: "200" },
      { check: "tests", severity: "warn", title: "1 test passes on base and fails on head" },
    ],
  };

  it("re-derives a hard-rule hit from the report and keeps it critical", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", tripped),
      reviewCall("call-1", "post_blocking_review", withFindings),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked");
    expect(p.hardRuleHits).toHaveLength(1);
    expect(p.hardRuleHits[0]).toMatchObject({
      severity: "critical",
      check: "tests",
      evidence: "t_x",
    });
    // The agent's `warn` for the same title is dropped, its other finding kept.
    expect(p.findings.map((f) => [f.source, f.severity, f.check])).toEqual([
      ["hard_rule", "critical", "tests"],
      ["hard_rule", "warn", "probes"],
      ["hard_rule", "warn", "smoke"],
      ["agent", "info", "smoke"],
    ]);
  });

  it("marks an advisory review that ignored a hard-rule hit as an error, not clean", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", tripped),
      reviewCall("call-0", "post_advisory_review", withFindings),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toContain("hard rule tripped");
    expect(p.error).toContain("advisory review");
    expect(p.findings[0]?.severity).toBe("critical");
  });

  it("blocks on a critical, without asking anyone (decision 138)", () => {
    // A broken test is mechanical, so Cujo blocks the merge on its own
    // authority: REQUEST_CHANGES is on the pull request and the check run
    // fails on the head. Terminal, and only `/cujo dismiss` moves it.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", tripped),
      reviewCall("call-0", "post_blocking_review", withFindings),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked");
    expect(p.review?.tool).toBe("post_blocking_review");
  });

  it("still folds a review whose arguments the renderer cannot take", () => {
    // The shape from orders-api #42's first blocking review: a coverage entry
    // with a note and no `check`. The renderer no longer throws on it, and
    // the fold would keep the model's own body if it ever did again, because
    // a fold that throws is a run that can never be projected.
    const args = {
      ...review,
      coverage: { ran: [{ note: "ran fine" }], skipped: [{ reason: "no boot" }] },
      egress: [{ host: "pypi.org", known: true, note: 3 }],
    };
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-1", "post_blocking_review", args),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked");
    expect(p.review?.body).toBe("What ran");
    expect(p.review?.composedBody).toContain("What ran");
  });

  it("blocks on a malice rule exactly as on a correctness one (decision 138)", () => {
    // There is no second review to hold: a malice finding is a critical, the
    // blocking review posts at once, and a person who disagrees lifts it.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-det", "detonation"),
      threadDone("th-det", detonated),
      reviewCall("call-0", "post_blocking_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked");
    expect(p.findings.some((f) => f.rule === "egress_to_unknown_host")).toBe(true);
  });

  it("marks an advisory review that carries the agent's own critical finding as an error", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", {
        ...review,
        findings: [{ check: "probes", severity: "critical", title: "probe disagrees" }],
      }),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.hardRuleHits).toEqual([]);
    expect(p.error).toBe(
      "critical finding (probe disagrees) but the agent posted an advisory review",
    );
  });

  it("carries the agent's findings on a clean run", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", report({ check: "tests", base_pass_head_fail: [] })),
      reviewCall("call-0", "post_advisory_review", withFindings),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("clean");
    expect(p.hardRuleHits).toEqual([]);
    // probes and smoke never arrived as threads, so each gets a warn.
    expect(p.findings.map((f) => [f.source, f.severity, f.check])).toEqual([
      ["hard_rule", "warn", "probes"],
      ["hard_rule", "warn", "smoke"],
      ["agent", "warn", "tests"],
      ["agent", "info", "smoke"],
    ]);
  });

  it("warns about a report it cannot read, and still applies the rules to it", () => {
    // The point of the whole arrangement: a sub-agent that got the envelope
    // wrong does not get its evidence ignored. `base_pass_head_fail` is right
    // there, so the critical stands, and the warn says the rest is worth less
    // than it looks.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", fenced({ check: "tests", base_pass_head_fail: ["t_x"] })),
      reviewCall("call-1", "post_blocking_review", review),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ]);
    const rules = p.hardRuleHits.map((f) => f.rule);
    expect(rules).toContain("tests_failed");
    expect(rules).toContain("report_invalid");
    expect(p.hardRuleHits.find((f) => f.rule === "report_invalid")).toMatchObject({
      severity: "warn",
      check: "tests",
    });
    // A malformed report is a claim about the evidence, never about the code,
    // so it must not put a review through the human gate.
    expect(p.hardRuleHits.filter((f) => f.rule === "report_invalid").map(isMaliceClaim)).toEqual([
      false,
    ]);
  });

  it("carries why the sub-agent's message ended into the missing-check warn", () => {
    // A report cut off at the model's output limit and a report never written
    // both parse to null. Only one of them is a cap somebody should raise.
    const cutOff: Ev = {
      type: "thread.done",
      id: "thd-cut",
      createdAt: at,
      threadId: "th-tests",
      title: "tests",
      parent: { threadId: "main", toolCallId: "spawn" },
      state: {
        status: "done",
        output: {
          type: "model.message",
          id: "out",
          createdAt: at,
          threadId: "th-tests",
          content: '```json\n{"check":"tests","runs":[',
          finishReason: "length",
        },
      },
    };
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      cutOff,
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.checks[0]?.finishReason).toBe("length");
    expect(p.findings.find((f) => f.check === "tests")?.evidence).toContain("output limit");
  });

  it("says nothing about the shape of a report that never arrived", () => {
    // `check_missing` already covers that, and saying both would be saying the
    // same thing twice.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", "no json here at all"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.findings.map((f) => f.rule)).not.toContain("report_invalid");
    expect(p.findings.filter((f) => f.check === "tests").map((f) => f.rule)).toEqual([
      "check_missing",
    ]);
  });

  it("warns for every required check the parent did not delegate", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-smoke", "smoke"),
      threadDone("th-smoke", report({ check: "smoke", endpoints: [] })),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("clean");
    expect(p.findings.map((f) => [f.severity, f.check])).toEqual([
      ["warn", "tests"],
      ["warn", "probes"],
    ]);
  });
});

describe("usage and timings in the fold", () => {
  const usage = (inputTokens: number, outputTokens: number): ModelMessageUsage =>
    ({ inputTokens, outputTokens }) as ModelMessageUsage;

  const message = (id: string, threadId: string, u: ModelMessageUsage | undefined): Ev => ({
    type: "model.message",
    id,
    createdAt: at,
    threadId,
    content: "thinking",
    ...(u ? { usage: u } : {}),
  });

  const doneWithMetrics = (metrics: TurnMetrics): Ev => turnDone({ ...doneState(), metrics });

  it("attributes a message's tokens to the check whose thread it came from", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      message("m1", "th-tests", usage(100, 10)),
      message("m2", "th-tests", usage(50, 5)),
      message("m3", "main", usage(999, 999)),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.checks[0]?.usage).toMatchObject({ inputTokens: 150, outputTokens: 15, messages: 2 });
  });

  it("counts a message once even if the same event arrives twice", () => {
    // The runner dedupes by id today. A sum that relies on a caller's invariant
    // is a sum that silently doubles the day that invariant changes.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      message("m1", "th-tests", usage(100, 10)),
      message("m1", "th-tests", usage(100, 10)),
      turnDone(),
    ]);
    expect(p.checks[0]?.usage).toMatchObject({ inputTokens: 100, messages: 1 });
  });

  it("takes the run total from the turn's own metrics, summed over turns", () => {
    const p = fold([
      turnCreated("t1"),
      doneWithMetrics({ totalInputTokens: 1000, totalOutputTokens: 100, totalCostInUsd: 0.5 }),
      turnCreated("t2"),
      doneWithMetrics({ totalInputTokens: 200, totalOutputTokens: 20, totalCostInUsd: 0.25 }),
    ]);
    expect(p.usage).toMatchObject({ inputTokens: 1200, outputTokens: 120, costUsd: 0.75 });
  });

  it("counts every message on every thread on the run total (decision 141)", () => {
    const p = fold([
      turnCreated("t1"),
      message("m0", "main", usage(1, 1)),
      threadCreated("th-tests", "tests"),
      message("m1", "th-tests", usage(100, 10)),
      message("m1", "th-tests", usage(100, 10)),
      message("m2", "main", undefined),
      doneWithMetrics({ totalInputTokens: 10 }),
    ]);
    expect(p.usage.messages).toBe(3);
  });

  it("keeps a ledger row per thread, the parent first, titled and never by id", () => {
    const result = (
      id: string,
      threadId: string,
      content: string,
      toolName = "sandbox_exec",
    ): Ev => ({
      type: "tool.response",
      id,
      createdAt: at,
      threadId,
      toolCallId: `call-${id}`,
      toolName,
      content,
      isError: false,
    });
    const p = fold([
      turnCreated("t1"),
      message("m0", "main", {
        inputTokens: 10,
        outputTokens: 1,
        reasoningTokens: 3,
      } as ModelMessageUsage),
      result("r0", "main", "x".repeat(300), "create_sub_agent"),
      threadCreated("th-tests", "tests"),
      message("m1", "th-tests", usage(100, 10)),
      result("r1", "th-tests", "y".repeat(5000)),
      result("r1", "th-tests", "y".repeat(5000)),
      message("m2", "th-tests", usage(50, 5)),
      // A second attempt at the same check is its own row, numbered.
      threadCreated("th-tests-2", "tests"),
      message("m3", "th-tests-2", usage(7, 7)),
      turnDone(),
    ]);
    expect(p.ledger.threads).toEqual([
      {
        title: "main",
        attempt: 1,
        messages: 1,
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 3,
        toolResultBytes: 300,
      },
      {
        title: "tests",
        attempt: 1,
        messages: 2,
        inputTokens: 150,
        outputTokens: 15,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolResultBytes: 5000,
      },
      {
        title: "tests",
        attempt: 2,
        messages: 1,
        inputTokens: 7,
        outputTokens: 7,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolResultBytes: 0,
      },
    ]);
    expect(p.ledger.largestToolResults).toEqual([
      { thread: "tests", tool: "sandbox_exec", bytes: 5000, isError: false },
      { thread: "main", tool: "create_sub_agent", bytes: 300, isError: false },
    ]);
    expect(JSON.stringify(p.ledger)).not.toContain("th-tests");
  });

  it("keeps only the ten largest tool results, largest first", () => {
    const events: Ev[] = [turnCreated("t1")];
    for (let i = 1; i <= 12; i += 1) {
      events.push({
        type: "tool.response",
        id: `r${i}`,
        createdAt: at,
        threadId: "main",
        toolCallId: `c${i}`,
        toolName: "sandbox_exec",
        content: "z".repeat(i * 10),
        isError: i === 12,
      });
    }
    const p = fold([...events, turnDone()]);
    expect(p.ledger.largestToolResults.map((r) => r.bytes)).toEqual([
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30,
    ]);
    expect(p.ledger.largestToolResults[0]?.isError).toBe(true);
    expect(p.ledger.threads[0]?.toolResultBytes).toBe(780);
  });

  it("leaves cost and reasoning tokens absent until a turn reports them", () => {
    // "No cost reported" and "cost zero" are not the same claim.
    const p = fold([turnCreated("t1"), doneWithMetrics({ totalInputTokens: 10 })]);
    expect(p.usage.costUsd).toBeUndefined();
    expect(p.usage.reasoningTokens).toBeUndefined();
    expect(p.usage.inputTokens).toBe(10);
  });

  it("records the cost of a turn that ended in error too", () => {
    // An error turn is exactly the one whose cost is worth seeing, and the
    // status ladder below breaks out of the case in half a dozen places. The
    // contract carries metrics on every finished state, and a turn the token
    // budget ended is the one whose bill matters most (decision 132).
    const p = fold([
      turnCreated("t1"),
      turnDone({
        status: "error",
        message: "token budget exhausted: 420000 of 400000",
        completedAt: at,
        metrics: { totalInputTokens: 400_000, totalOutputTokens: 20_000, totalTokens: 420_000 },
      }),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toBe("token budget exhausted: 420000 of 400000");
    expect(p.usage).toMatchObject({ inputTokens: 400_000, outputTokens: 20_000 });
  });

  it("records the cost of a cancelled turn", () => {
    const p = fold([
      turnCreated("t1"),
      turnDone({
        status: "cancelled",
        reason: "client-cancelled",
        completedAt: at,
        metrics: { totalInputTokens: 10, totalOutputTokens: 1 },
      }),
    ]);
    expect(p.usage).toMatchObject({ inputTokens: 10, outputTokens: 1 });
  });

  it("puts the timings on the check when its thread ends", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests", "2026-08-27T00:00:00Z"),
      threadDone(
        "th-tests",
        '```json\n{"check":"tests","runs":[{"duration_s":30}]}\n```',
        "2026-08-27T00:01:40Z",
      ),
    ]);
    expect(p.checks[0]?.timings).toEqual({
      wallMs: 100_000,
      sandboxMs: 30_000,
      modelMs: 70_000,
    });
  });
});

describe("the diff review's ladder (decision 136)", () => {
  const diff = { mode: "diff" as const };
  const advisory = (findings: unknown[] = []) =>
    reviewCall("call-0", "post_advisory_review", { body: "Read it.", findings });

  it("is clean when one advisory posted and no check ever ran", () => {
    // The sandbox ladder would say `unproven` here; a diff run never had
    // evidence to post and its record says so (decision 135).
    const p = fold([turnCreated("t1"), advisory(), toolResponse("call-0"), turnDone()], diff);
    expect(p.status).toBe("clean");
    expect(p.checks).toEqual([]);
    expect(p.findings).toEqual([]);
  });

  it("adds no check_missing warning, since nothing was meant to run", () => {
    const events = [turnCreated("t1"), advisory(), toolResponse("call-0"), turnDone()];
    expect(fold(events, diff).findings.map((f) => f.rule)).toEqual([]);
    // The same stream read as a sandbox run is a run that lost its checks.
    const sandbox = fold(events);
    expect(sandbox.status).toBe("unproven");
    expect(sandbox.findings.map((f) => f.rule)).toEqual([
      "check_missing",
      "check_missing",
      "check_missing",
    ]);
  });

  it("carries the agent's warn and info findings", () => {
    const p = fold(
      [
        turnCreated("t1"),
        advisory([
          { check: "diff", severity: "warn", title: "Unpinned dependency", path: "a.ts", line: 2 },
          { check: "diff", severity: "info", title: "Renames the helper" },
        ]),
        toolResponse("call-0"),
        turnDone(),
      ],
      diff,
    );
    expect(p.status).toBe("clean");
    expect(p.findings.map((f) => [f.severity, f.title])).toEqual([
      ["warn", "Unpinned dependency"],
      ["info", "Renames the helper"],
    ]);
  });

  it("is an error when the advisory carries a critical, the rubric forbids it", () => {
    // Same rung as the sandbox ladder: the review is already on the pull
    // request, so the contradiction is recorded rather than clamped (74).
    const p = fold(
      [
        turnCreated("t1"),
        advisory([{ check: "diff", severity: "critical", title: "Breaks the build" }]),
        toolResponse("call-0"),
        turnDone(),
      ],
      diff,
    );
    expect(p.status).toBe("error");
    expect(p.error).toBe(
      "critical finding (Breaks the build) but the agent posted an advisory review",
    );
  });

  it("is an error naming the tool when anything but the advisory tool posted", () => {
    const blocking = fold(
      [
        turnCreated("t1"),
        reviewCall("call-0", "post_blocking_review", { body: "b", findings: [] }),
        toolResponse("call-0"),
        turnDone(),
      ],
      diff,
    );
    expect(blocking.status).toBe("error");
    expect(blocking.error).toBe(
      "diff review called post_blocking_review; only post_advisory_review may post",
    );
  });

  it("is an error when the turn ended without a review, and keeps a turn error's message", () => {
    expect(fold([turnCreated("t1"), turnDone()], diff)).toMatchObject({
      status: "error",
      error: "turn ended without a review",
    });
    expect(
      fold(
        [
          turnCreated("t1"),
          turnDone({ status: "error", message: "token budget exhausted: 9 of 8", completedAt: at }),
        ],
        diff,
      ),
    ).toMatchObject({ status: "error", error: "token budget exhausted: 9 of 8" });
  });

  it("leaves a sandbox run's ladder untouched when no mode is given", () => {
    const events = [turnCreated("t1"), advisory(), toolResponse("call-0"), turnDone()];
    expect(fold(events).status).toBe("unproven");
    expect(fold(events, { mode: "sandbox" }).status).toBe("unproven");
  });
});

describe("parseReview", () => {
  const call = (id: string, name: string, args: string): ToolCall => ({
    id,
    type: "function",
    function: { name, arguments: args },
    toolInfo: { type: "mcp", name, serverName: "github-mcp" },
  });

  it("reads a review tool called by name (decision 128)", () => {
    const parsed = parseReview(call("c1", "post_blocking_review", JSON.stringify(review)));
    expect(parsed).toEqual({
      tool: "post_blocking_review",
      toolCallId: "c1",
      body: "What ran",
      // A legacy call: the model's own prose lands under `### Notes`, and its
      // own comments are kept rather than derived (decision 74).
      composedBody: expect.stringContaining("**Blocked**"),
      comments: [{ path: "a.py", line: 3, body: "boom" }],
      findings: [],
    });
  });

  it("ignores anything but a review tool, and tolerates malformed arguments", () => {
    expect(parseReview(call("c2", "sandbox_exec", "{}"))).toBeNull();
    expect(parseReview(call("c3", "create_sub_agent", '{"name":"tests"}'))).toBeNull();
    expect(
      parseReview(call("c4", "post_advisory_review", JSON.stringify({ body: 42 }))),
    ).toMatchObject({ tool: "post_advisory_review", body: "", comments: [] });
    // JSON that is not an object must not throw mid-fold.
    for (const raw of ["null", "[]", "42", '"s"', "{not json"]) {
      expect(parseReview(call("c6", "post_advisory_review", raw))).toMatchObject({
        tool: "post_advisory_review",
        comments: [],
      });
    }
  });
});

describe("check timing", () => {
  it("stamps each check from its own thread events, not the clock", () => {
    // Taken from the events so the fold stays pure: replaying the same stream
    // after a restart has to produce the same timings.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests", "2026-08-27T00:00:02Z"),
      threadCreated("th-probes", "probes", "2026-08-27T00:00:04Z"),
      threadDone("th-tests", "```json\n{}\n```", "2026-08-27T00:01:52Z"),
    ]);
    const tests = p.checks.find((c) => c.title === "tests");
    const probes = p.checks.find((c) => c.title === "probes");
    expect(tests?.startedAt).toBe("2026-08-27T00:00:02Z");
    expect(tests?.endedAt).toBe("2026-08-27T00:01:52Z");
    // Still running, so it has a start and no end.
    expect(probes?.startedAt).toBe("2026-08-27T00:00:04Z");
    expect(probes?.endedAt).toBeNull();
  });

  it("stamps a check that ended in error too", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-smoke", "smoke", "2026-08-27T00:00:06Z"),
      {
        type: "thread.done",
        id: "thd-err",
        createdAt: "2026-08-27T00:00:30Z",
        threadId: "th-smoke",
        title: "smoke",
        state: { status: "error", error: "sandbox exited" },
      } as Ev,
    ]);
    const smoke = p.checks.find((c) => c.title === "smoke");
    expect(smoke?.status).toBe("error");
    expect(smoke?.endedAt).toBe("2026-08-27T00:00:30Z");
  });

  it("is replayable: the same events fold to the same timings", () => {
    const events = [
      turnCreated("t1"),
      threadCreated("th-tests", "tests", "2026-08-27T00:00:02Z"),
      threadDone("th-tests", "```json\n{}\n```", "2026-08-27T00:01:52Z"),
    ];
    expect(fold(events).checks).toEqual(fold(events).checks);
  });
});

describe("parseReport", () => {
  it("accepts a bare object and rejects prose", () => {
    expect(parseReport('{"a":1}')).toEqual({ a: 1 });
    expect(parseReport("nothing here")).toBeNull();
    expect(parseReport('Report:\n```\n{"b": 2}\n```\n')).toEqual({ b: 2 });
  });
});

describe("the setup window", () => {
  const claim = "2026-08-27T00:00:00.000Z";
  const spoke = "2026-08-27T00:00:15.000Z";
  const spawn = "2026-08-27T00:01:15.000Z";

  it("stamps each end of the window from the event that marks it", () => {
    const p = fold([
      turnCreated("t1", undefined, claim),
      mainMessage("m1", spoke),
      threadCreated("sub-1", "tests", spawn),
    ]);
    expect(p.setup).toEqual({
      turnCreatedAt: claim,
      sandboxCreatedAt: null,
      agentStartedAt: spoke,
      firstCheckAt: spawn,
      messages: 1,
      ms: 60_000,
    });
  });

  it("leaves the sandbox stamp null: the harness provisions nothing (decision 113)", () => {
    const p = fold([
      turnCreated("t2", undefined, claim),
      mainMessage("m1", spoke),
      threadCreated("sub-1", "tests", spawn),
    ]);
    expect(p.setup.sandboxCreatedAt).toBeNull();
    expect(p.setup.ms).toBe(60_000);
  });

  it("counts the parent's round trips, and stops at the first check", () => {
    const p = fold([
      turnCreated("t1", undefined, claim),
      mainMessage("m1", spoke),
      mainMessage("m2", spoke),
      mainMessage("m3", spoke),
      threadCreated("sub-1", "tests", spawn),
      // Everything after the spawn is the review being written, not setup.
      mainMessage("m4", spawn),
      mainMessage("m5", spawn),
    ]);
    expect(p.setup.messages).toBe(3);
  });

  it("counts a replayed message once", () => {
    // `hydrate` replaces a streamed event with its persisted copy by id, so one
    // id reaching the fold twice is a shape this has to survive.
    const p = fold([
      turnCreated("t1", undefined, claim),
      mainMessage("m1", spoke),
      mainMessage("m1", spoke),
    ]);
    expect(p.setup.messages).toBe(1);
  });

  it("closes the window on a named check and not on any other thread", () => {
    const p = fold([
      turnCreated("t1", undefined, claim),
      mainMessage("m1", spoke),
      // A helper the rubric never named. Setup is not over, so the parent's
      // next message is still a setup round trip.
      threadCreated("sub-0", "scratch", spoke),
      mainMessage("m2", spoke),
      threadCreated("sub-1", "probes", spawn),
    ]);
    expect(p.setup.firstCheckAt).toBe(spawn);
    expect(p.setup.messages).toBe(2);
  });

  it("keeps the first turn's stamp when a retry starts another", () => {
    const later = "2026-08-27T01:00:00.000Z";
    const p = fold([
      turnCreated("t1", undefined, claim),
      threadCreated("sub-1", "tests", spawn),
      turnDone(),
      turnCreated("t2", undefined, later),
    ]);
    expect(p.setup.turnCreatedAt).toBe(claim);
  });

  it("omits the span when no check ever started", () => {
    const p = fold([turnCreated("t1", undefined, claim), mainMessage("m1", spoke)]);
    expect(p.setup.firstCheckAt).toBeNull();
    expect(p.setup.ms).toBeUndefined();
  });
});

/**
 * The board and the pull request describe a review the same way (decision 74).
 *
 * The test the first cut of that decision did not have. It derived the inline
 * comments twice — once in `github-mcp` to post them, once in `apps/cujo` to
 * show them — and the two drifted in three ways before review caught it: a
 * dedupe key missing `check`, a title translated on one side only, and a board
 * showing the one-sentence lede where GitHub had the whole review.
 *
 * Both sides call `@cujo/review-render` now, so what this pins is that
 * `parseReview` really routes through it rather than growing a second
 * implementation again.
 */

const sharedArgs = {
  body: "A dependency added by this PR reads credentials while it installs.",
  findings: [
    {
      check: "detonation",
      severity: "critical",
      // The case the whole decision is about: a title that is still a field
      // name, which one side used to translate and the other did not.
      title: "secret_probe.decoy_read: true",
      evidence: "read at 12:04:31 during pip install",
      detail: "Nothing in the package's stated purpose needs the environment.",
      next: "drop the dependency, or pin an audited version",
      path: "pyproject.toml",
      line: 7,
    },
    {
      check: "probes",
      severity: "warn",
      title: "no test covers the refund path",
      evidence: "refund_window() is called by nothing under tests/",
      path: "app/refunds.py",
      line: 17,
    },
  ],
  coverage: { ran: [{ check: "tests", note: "212 on base and head" }], skipped: [] },
  egress: [{ host: "pypi.org", port: 443, known: true }],
};

const reviewToolCall = (name: string): ToolCall =>
  ({
    id: "call-1",
    type: "function",
    function: { name, arguments: JSON.stringify(sharedArgs) },
  }) as unknown as ToolCall;

describe("parseReview agrees with what github-mcp posts", () => {
  it("is the body github-mcp composes, not the lede the model sent", () => {
    const parsed = parseReview(reviewToolCall("post_blocking_review"));
    expect(parsed?.composedBody).toBe(
      renderReviewBody(sharedArgs as Parameters<typeof renderReviewBody>[0], {
        tool: "post_blocking_review",
        runUrl: null,
      }),
    );
    // The lede is kept too, but it is not the review.
    expect(parsed?.body).toBe(sharedArgs.body);
    expect(parsed?.composedBody).not.toBe(parsed?.body);
  });

  it("carries the verdict, the findings, the coverage and the egress", () => {
    const body = parseReview(reviewToolCall("post_blocking_review"))?.composedBody ?? "";
    expect(body).toContain("**Blocked** — 1 critical, 1 warn");
    expect(body).toContain("### Coverage");
    expect(body).toContain("Egress: 1 known host.");
  });

  it("translates a field-name title exactly as the posted review does", () => {
    const body = parseReview(reviewToolCall("post_blocking_review"))?.composedBody ?? "";
    expect(body).toContain("**the seeded decoy secret was read**");
    // The raw expression survives, moved to where a field name belongs.
    expect(body).toContain("secret_probe.decoy_read: true; read at 12:04:31");
  });

  it("derives the same inline comments github-mcp derives, byte for byte", () => {
    expect(parseReview(reviewToolCall("post_advisory_review"))?.comments).toEqual(
      reviewComments(sharedArgs as Parameters<typeof reviewComments>[0]),
    );
  });
});

describe("executed checks (decision 161)", () => {
  const envelope = (over: Record<string, unknown> = {}) => ({
    schema_version: 1,
    check: "tests",
    base: { "t.py::a": "pass" },
    head: { "t.py::a": "fail" },
    base_pass_head_fail: ["t.py::a"],
    runs: [],
    derived: {},
    sensors: { proxy: { armed: true }, decoy: { armed: true } },
    truncated: {},
    ...over,
  });
  const executed = (over: Record<string, unknown> = {}) => [
    {
      check: "tests",
      report: envelope(over),
      startedAt: "2026-08-27T00:00:00Z",
      endedAt: "2026-08-27T00:01:30Z",
    },
  ];

  it("seats an executed check before any event, with its timings and no thread", () => {
    const p = fold([], { executed: executed(), sandbox: { provisionedMs: 1234 } });
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0]).toMatchObject({
      threadId: executedThreadId("tests"),
      title: "tests",
      isCheck: true,
      status: "done",
      attempts: 1,
      timings: { wallMs: 90_000 },
    });
    expect(p.setup.sandboxProvisionedMs).toBe(1234);
    expect(p.ledger.threads).toEqual([]);
  });

  it("trips the hard rule on an executed report with no sub-agent behind it", () => {
    const p = fold([turnCreated("t1")], { executed: executed() });
    expect(p.hardRuleHits.map((f) => f.rule)).toEqual(["tests_failed"]);
    expect(p.findings[0]).toMatchObject({ severity: "critical", check: "tests" });
  });

  it("owes no tests report at the end of the turn, and still owes the others", () => {
    const p = fold([turnCreated("t1"), turnDone()], {
      executed: executed({ base_pass_head_fail: [] }),
    });
    const missing = p.findings.filter((f) => f.rule === "check_missing").map((f) => f.check);
    expect(missing).toEqual(["probes", "smoke"]);
  });

  it("closes the setup window at the turn's creation, from the executor's start", () => {
    const p = fold([turnCreated("t1", [], "2026-08-27T00:02:00Z")], { executed: executed() });
    expect(p.setup.agentStartedAt).toBe("2026-08-27T00:00:00Z");
    expect(p.setup.firstCheckAt).toBe("2026-08-27T00:02:00Z");
    expect(p.setup.ms).toBe(120_000);
  });
});
