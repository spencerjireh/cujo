import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import { isMaliceClaim } from "../../src/review/findings";
import { fold, parseReport, parseReview, pendingApproval } from "../../src/review/fold";

type Ev = TrueForgeApi.SessionEvent;
const at = "2026-08-27T00:00:00Z";

const turnCreated = (
  turnId: string,
  input?: TrueForgeApi.TurnInputItem[],
  createdAt: string = at,
): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt,
  threadId: null,
  turnId,
  previousTurnId: null,
  state: { status: "running" },
  ...(input ? { input } : {}),
});

const sandboxCreated = (createdAt: string): Ev => ({
  type: "sandbox.created",
  id: "sbx",
  createdAt,
  threadId: null,
  sandboxId: "sb-1",
});

/** A parent turn with no tool call: one round trip, and nothing else. */
const mainMessage = (id: string, createdAt: string): Ev => ({
  type: "model.message",
  id,
  createdAt,
  threadId: "main",
  content: "",
});

const turnDone = (state: TrueForgeApi.TurnDoneEventState = doneState()): Ev => ({
  type: "turn.done",
  id: "td",
  createdAt: at,
  threadId: null,
  state,
});

function doneState(): TrueForgeApi.TurnStateDone {
  return { status: "done", completedAt: at, output: null, requiredActions: [] };
}

const reviewCall = (id: string, name: string, args: unknown): Ev => ({
  type: "model.message",
  id: `mm-${id}`,
  createdAt: at,
  threadId: "main",
  toolCalls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
      toolInfo: {
        type: "mcp",
        mcpServerId: "x",
        mcpServerName: "github-mcp",
        originalToolName: name,
      },
    } as unknown as TrueForgeApi.ToolCall,
  ],
});

const approvalRequired = (threadId: string, callId: string, sourceEventId: string): Ev => ({
  type: "tool.approval_required",
  id: "ar",
  createdAt: at,
  threadId,
  toolCalls: [{ id: callId, sourceEventId }],
});

const toolResponse = (toolCallId: string): Ev => ({
  type: "tool.response",
  id: "tr",
  createdAt: at,
  threadId: "main",
  toolCallId,
  content: "{}",
});

const threadCreated = (threadId: string, title: string, createdAt: string = at): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: {} as TrueForgeApi.AgentInfo,
});

const threadDone = (threadId: string, text: string, createdAt: string = at): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt,
  threadId,
  title: threadId,
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
const resume = (status: "allow" | "deny"): TrueForgeApi.TurnInputItem[] => [
  { type: "user.tool_approval", threadId: "main", toolCallId: "call-1", approval: { status } },
];

describe("fold", () => {
  it("is running with no events and appends turn ids", () => {
    const p = fold([turnCreated("t1")]);
    expect(p.status).toBe("running");
    expect(p.turnIds).toEqual(["t1"]);
  });

  it("is clean when the turn ends without an approval", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("clean");
    expect(p.review?.tool).toBe("post_advisory_review");
    expect(p.review?.comments).toHaveLength(1);
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

  it("derives the held review's comments from its own findings", () => {
    // `gatedReview` is a separate call with a separate findings list, and the
    // withholding rule reads that list — so the derivation must follow it.
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-1", "post_gated_review", derivedReview),
      approvalRequired("main", "call-1", "mm-call-1"),
    ]);
    expect(p.gatedReview?.comments).toHaveLength(1);
    expect(p.review).toBeNull();
  });

  it("is error, not clean, when the turn ends without any review call", () => {
    const p = fold([turnCreated("t1"), turnDone()]);
    expect(p.status).toBe("error");
    expect(p.error).toBe("turn ended without a review");
  });

  it("is blocked_pending on an approval on main and reads the drafted review", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-1", "post_blocking_review", review),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_pending");
    expect(p.approval).toEqual({
      threadId: "main",
      toolCallId: "call-1",
      sourceEventId: "mm-call-1",
    });
    expect(p.review).toMatchObject({ tool: "post_blocking_review", body: "What ran" });
  });

  it("is blocked_posted after Cujo's allow resume and the gated tool.response", () => {
    const p = fold(
      [
        turnCreated("t1"),
        reviewCall("call-1", "post_blocking_review", review),
        approvalRequired("main", "call-1", "mm-call-1"),
        turnDone(),
        turnCreated("t2", resume("allow")),
        toolResponse("call-1"),
        turnDone(),
      ],
      { cujoResumeTurnIds: new Set(["t2"]) },
    );
    expect(p.status).toBe("blocked_posted");
    expect(p.turnIds).toEqual(["t1", "t2"]);
    expect(p.externalResume).toBe(false);
  });

  it("is denied after a deny resume, with or without the refusal tool.response", () => {
    const paused = [
      turnCreated("t1"),
      reviewCall("call-1", "post_blocking_review", review),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ];
    const options = { cujoResumeTurnIds: new Set(["t2"]) };
    expect(fold([...paused, turnCreated("t2", resume("deny")), turnDone()], options).status).toBe(
      "denied",
    );
    // The server answers a denied call with a tool.response carrying the
    // refusal (contract test: "a denied blocking review folds to denied").
    expect(
      fold(
        [...paused, turnCreated("t2", resume("deny")), toolResponse("call-1"), turnDone()],
        options,
      ).status,
    ).toBe("denied");
  });

  it("marks a resume Cujo did not send as external", () => {
    const p = fold([
      turnCreated("t1"),
      reviewCall("call-1", "post_blocking_review", review),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
      turnCreated("t2", resume("allow")),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_posted");
    expect(p.externalResume).toBe(true);
  });

  it("is error on a turn error", () => {
    const p = fold([
      turnCreated("t1"),
      turnDone({ status: "error", message: "model down", completedAt: at }),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toBe("model down");
  });

  it("trips on an approval from a subagent thread and offers no approval", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("sub-1", "tests"),
      approvalRequired("sub-1", "call-9", "nope"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.approval).toBeNull();
    expect(p.error).toContain("sub-1");
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
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_pending");
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

  it("blocks unattended on a correctness critical, without asking anyone", () => {
    // The whole point of Design 1: a broken test is mechanical, so Cujo blocks
    // the merge on its own authority. Before the gate moved, this run had no
    // terminal state to land in and fell through to `clean` — a green board
    // row for a pull request carrying REQUEST_CHANGES.
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-tests", "tests"),
      threadDone("th-tests", tripped),
      reviewCall("call-0", "post_blocking_review", withFindings),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_unattended");
    expect(p.review?.tool).toBe("post_blocking_review");
    expect(p.gatedReview).toBeNull();
    expect(p.approval).toBeNull();
  });

  it("keeps the posted advisory and the held accusation in separate slots", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-det", "detonation"),
      threadDone("th-det", detonated),
      reviewCall("call-0", "post_advisory_review", { ...review, body: "the observation" }),
      toolResponse("call-0"),
      reviewCall("call-1", "post_gated_review", accusation),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_pending");
    // The second call must not destroy the record of the first: the advisory
    // is on the pull request and the operator has to be shown that.
    expect(p.review).toMatchObject({ tool: "post_advisory_review", body: "the observation" });
    expect(p.gatedReview).toMatchObject({ tool: "post_gated_review" });
  });

  it("holds the accusation's own findings back until it posts", () => {
    const drafted = [
      turnCreated("t1"),
      threadCreated("th-det", "detonation"),
      threadDone("th-det", detonated),
      reviewCall("call-0", "post_advisory_review", review),
      toolResponse("call-0"),
      reviewCall("call-1", "post_gated_review", accusation),
      approvalRequired("main", "call-1", "mm-call-1"),
      turnDone(),
    ];
    const pending = fold(drafted);
    // The hard-rule observation publishes — it is Cujo's own measurement — but
    // the agent's accusation does not, because `findings` reaches the
    // anonymous board and this is the thing the gate exists to hold back.
    expect(pending.findings.some((f) => f.rule === "egress_to_unknown_host")).toBe(true);
    expect(pending.findings.some((f) => f.title === "the dependency is malware")).toBe(false);

    const confirmed = fold([
      ...drafted,
      turnCreated("t2", [
        {
          type: "user.tool_approval",
          threadId: "main",
          toolCallId: "call-1",
          approval: { status: "allow" },
        } as unknown as TrueForgeApi.TurnInputItem,
      ]),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(confirmed.status).toBe("blocked_posted");
    expect(confirmed.findings.some((f) => f.title === "the dependency is malware")).toBe(true);

    // A denied call is answered with a refusal `tool.response` of its own, so
    // "a response arrived" cannot be what publishes. The accusation a human
    // turned down must leave nothing behind — the observation still stands.
    const denied = fold([
      ...drafted,
      turnCreated("t2", [
        {
          type: "user.tool_approval",
          threadId: "main",
          toolCallId: "call-1",
          approval: { status: "deny" },
        } as unknown as TrueForgeApi.TurnInputItem,
      ]),
      toolResponse("call-1"),
      turnDone(),
    ]);
    expect(denied.status).toBe("denied");
    expect(denied.findings.some((f) => f.title === "the dependency is malware")).toBe(false);
    expect(denied.findings.some((f) => f.rule === "egress_to_unknown_host")).toBe(true);
  });

  it("reports under-gating: a malice rule tripped and nothing was held", () => {
    // The one direction of model error the trusted side can detect. Cujo
    // cannot know a gated review was unnecessary, but it always knows when one
    // was necessary and absent (decision 21).
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-det", "detonation"),
      threadDone("th-det", detonated),
      reviewCall("call-0", "post_blocking_review", review),
      toolResponse("call-0"),
      turnDone(),
    ]);
    expect(p.status).toBe("error");
    expect(p.error).toContain("malice rule tripped");
    expect(p.error).toContain("did not hold the accusation for a human");
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
  const usage = (inputTokens: number, outputTokens: number): TrueForgeApi.ModelMessageUsage =>
    ({ inputTokens, outputTokens }) as TrueForgeApi.ModelMessageUsage;

  const message = (
    id: string,
    threadId: string,
    u: TrueForgeApi.ModelMessageUsage | undefined,
  ): Ev => ({
    type: "model.message",
    id,
    createdAt: at,
    threadId,
    content: "thinking",
    ...(u ? { usage: u } : {}),
  });

  const doneWithMetrics = (metrics: TrueForgeApi.TurnMetrics): Ev =>
    turnDone({ ...doneState(), metrics });

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

  it("leaves cost and reasoning tokens absent until a turn reports them", () => {
    // "No cost reported" and "cost zero" are not the same claim.
    const p = fold([turnCreated("t1"), doneWithMetrics({ totalInputTokens: 10 })]);
    expect(p.usage.costUsd).toBeUndefined();
    expect(p.usage.reasoningTokens).toBeUndefined();
    expect(p.usage.inputTokens).toBe(10);
  });

  it("records the cost of a turn that ended in error too", () => {
    // An error turn is exactly the one whose cost is worth seeing, and the
    // status ladder below breaks out of the case in half a dozen places.
    const p = fold([
      turnCreated("t1"),
      turnDone({ status: "error", message: "model down", completedAt: at }),
    ]);
    expect(p.status).toBe("error");
    expect(p.usage.messages).toBe(0);
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

describe("parseReview", () => {
  const callTool = (id: string, args: unknown) =>
    ({
      id,
      type: "function",
      function: { name: "call_tool", arguments: JSON.stringify(args) },
      toolInfo: { type: "truefoundry-system", name: "call_tool" },
    }) as unknown as TrueForgeApi.ChatCompletionMessageToolCall;

  it("reads a review posted through the call_tool meta-tool", () => {
    const parsed = parseReview(
      callTool("c1", {
        mcp_server: "github-mcp",
        tool_name: "post_blocking_review",
        input: review,
      }),
    );
    expect(parsed).toEqual({
      tool: "post_blocking_review",
      toolCallId: "c1",
      body: "What ran",
      comments: [{ path: "a.py", line: 3, body: "boom" }],
      findings: [],
    });
  });

  it("ignores call_tool for anything but a review tool on github-mcp, and malformed input", () => {
    expect(parseReview(callTool("c2", { mcp_server: "x", tool_name: "list_tools" }))).toBeNull();
    expect(parseReview(callTool("c3", { mcp_server: "github-mcp" }))).toBeNull();
    // A same-named tool on another server posts nothing.
    expect(
      parseReview(callTool("c5", { mcp_server: "other", tool_name: "post_advisory_review" })),
    ).toBeNull();
    expect(
      parseReview(
        callTool("c4", {
          mcp_server: "github-mcp",
          tool_name: "post_advisory_review",
          input: "not an object",
        }),
      ),
    ).toMatchObject({ tool: "post_advisory_review", body: "", comments: [] });
    // JSON that is not an object must not throw mid-fold.
    for (const raw of ["null", "[]", "42", '"s"', "{not json"]) {
      const call = {
        id: "c6",
        type: "function",
        function: { name: "call_tool", arguments: raw },
      } as unknown as TrueForgeApi.ChatCompletionMessageToolCall;
      expect(parseReview(call)).toBeNull();
    }
    const direct = {
      id: "c7",
      type: "function",
      function: { name: "post_advisory_review", arguments: "null" },
    } as unknown as TrueForgeApi.ChatCompletionMessageToolCall;
    expect(parseReview(direct)).toMatchObject({ tool: "post_advisory_review", comments: [] });
  });

  it("folds a call_tool review the same as a direct one", () => {
    const message: Ev = {
      type: "model.message",
      id: "mm-1",
      createdAt: at,
      threadId: "main",
      toolCalls: [
        callTool("call-1", {
          mcp_server: "github-mcp",
          tool_name: "post_blocking_review",
          input: review,
        }) as unknown as TrueForgeApi.ToolCall,
      ],
    };
    const p = fold([
      turnCreated("t1"),
      message,
      approvalRequired("main", "call-1", "mm-1"),
      turnDone(),
    ]);
    expect(p.status).toBe("blocked_pending");
    expect(p.review?.tool).toBe("post_blocking_review");
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

describe("pendingApproval", () => {
  const answer = (toolCallId: string): TrueForgeApi.TurnInputItem[] => [
    { type: "user.tool_approval", threadId: "main", toolCallId, approval: { status: "allow" } },
  ];

  it("is null for a session that never asked", () => {
    expect(pendingApproval([])).toBeNull();
    expect(pendingApproval([turnCreated("t1"), turnDone()])).toBeNull();
  });

  it("returns the request nothing has answered", () => {
    const events = [turnCreated("t1"), approvalRequired("main", "call-1", "mm-1"), turnDone()];
    expect(pendingApproval(events)).toEqual({
      threadId: "main",
      toolCallId: "call-1",
      sourceEventId: "mm-1",
    });
  });

  it("is null once a resume answers that same tool call", () => {
    const events = [
      turnCreated("t1"),
      approvalRequired("main", "call-1", "mm-1"),
      turnDone(),
      turnCreated("t2", answer("call-1")),
      turnDone(),
    ];
    expect(pendingApproval(events)).toBeNull();
  });

  /**
   * The case `fold` cannot see: it leaves `approval` set and `decision` set,
   * which reads as answered even though the second request is outstanding.
   */
  it("returns the second request when only the first was answered", () => {
    const events = [
      turnCreated("t1"),
      approvalRequired("main", "call-1", "mm-1"),
      turnDone(),
      turnCreated("t2", answer("call-1")),
      approvalRequired("main", "call-2", "mm-2"),
      turnDone(),
    ];
    expect(fold(events).approval?.toolCallId).toBe("call-2");
    expect(fold(events).decision).toBe("allow");
    expect(pendingApproval(events)?.toolCallId).toBe("call-2");
  });

  it("ignores a resume that answers some other tool call", () => {
    const events = [
      turnCreated("t1"),
      approvalRequired("main", "call-1", "mm-1"),
      turnDone(),
      turnCreated("t2", answer("call-9")),
    ];
    expect(pendingApproval(events)?.toolCallId).toBe("call-1");
  });

  it("never returns a request from a thread that may not hold one", () => {
    const events = [turnCreated("t1"), approvalRequired("sub-1", "call-9", "nope"), turnDone()];
    expect(pendingApproval(events)).toBeNull();
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
  const boxed = "2026-08-27T00:00:10.000Z";
  const spoke = "2026-08-27T00:00:15.000Z";
  const spawn = "2026-08-27T00:01:15.000Z";

  it("stamps each end of the window from the event that marks it", () => {
    const p = fold([
      turnCreated("t1", undefined, claim),
      sandboxCreated(boxed),
      mainMessage("m1", spoke),
      threadCreated("sub-1", "tests", spawn),
    ]);
    expect(p.setup).toEqual({
      turnCreatedAt: claim,
      sandboxCreatedAt: boxed,
      agentStartedAt: spoke,
      firstCheckAt: spawn,
      messages: 1,
      ms: 60_000,
    });
  });

  it("leaves the sandbox stamp null when the session already had one", () => {
    // A second run on the same pull request. `hydrate` scopes a fold to this
    // run's own turns, so the first run's `sandbox.created` is not in the
    // stream — the sandbox was already there, which is why a re-run is faster.
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

  it("keeps the first turn's stamp when an approval resume starts another", () => {
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
