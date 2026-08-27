import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import { fold, parseReport } from "./folder";

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

const threadCreated = (threadId: string, title: string): Ev => ({
  type: "thread.created",
  id: `thc-${threadId}`,
  createdAt: at,
  threadId,
  title,
  parent: { threadId: "main", toolCallId: "spawn" },
  agentInfo: {} as TrueForgeApi.AgentInfo,
});

const threadDone = (threadId: string, text: string): Ev => ({
  type: "thread.done",
  id: `thd-${threadId}`,
  createdAt: at,
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

  it("is denied after a deny resume with no gated response", () => {
    const p = fold(
      [
        turnCreated("t1"),
        reviewCall("call-1", "post_blocking_review", review),
        approvalRequired("main", "call-1", "mm-call-1"),
        turnDone(),
        turnCreated("t2", resume("deny")),
        turnDone(),
      ],
      { cujoResumeTurnIds: new Set(["t2"]) },
    );
    expect(p.status).toBe("denied");
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

describe("parseReport", () => {
  it("accepts a bare object and rejects prose", () => {
    expect(parseReport('{"a":1}')).toEqual({ a: 1 });
    expect(parseReport("nothing here")).toBeNull();
    expect(parseReport('Report:\n```\n{"b": 2}\n```\n')).toEqual({ b: 2 });
  });
});
