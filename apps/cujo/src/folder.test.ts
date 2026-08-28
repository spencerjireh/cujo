import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import { fold, parseReport, parseReview } from "./folder";

type Ev = TrueForgeApi.SessionEvent;
const at = "2026-08-27T00:00:00Z";

const turnCreated = (turnId: string, input?: TrueForgeApi.TurnInputItem[]): Ev => ({
  type: "turn.created",
  id: `tc-${turnId}`,
  createdAt: at,
  threadId: null,
  turnId,
  previousTurnId: null,
  state: { status: "running" },
  ...(input ? { input } : {}),
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

const review = { body: "What ran", comments: [{ path: "a.py", line: 3, body: "boom" }] };
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
  const tripped = fenced({ check: "tests", base_pass_head_fail: ["t_x"] });
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
      threadDone("th-tests", fenced({ check: "tests", base_pass_head_fail: [] })),
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

  it("warns for every required check the parent did not delegate", () => {
    const p = fold([
      turnCreated("t1"),
      threadCreated("th-smoke", "smoke"),
      threadDone("th-smoke", fenced({ check: "smoke", endpoints: [] })),
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

describe("parseReport", () => {
  it("accepts a bare object and rejects prose", () => {
    expect(parseReport('{"a":1}')).toEqual({ a: 1 });
    expect(parseReport("nothing here")).toBeNull();
    expect(parseReport('Report:\n```\n{"b": 2}\n```\n')).toEqual({ b: 2 });
  });
});
