import { describe, expect, it } from "vitest";
import {
  AgentSpecSchema,
  ModelProviderManifestSchema,
  SessionEventSchema,
  StreamEventSchema,
  TurnInputItemSchema,
} from "../src/index";

const base = { id: "e1", createdAt: "2026-09-12T00:00:00Z", threadId: "main" };

describe("AgentSpecSchema", () => {
  it("defaults mcpServers and requireApprovalForTools to empty", () => {
    const spec = AgentSpecSchema.parse({
      model: { name: "openrouter/glm" },
      instructions: "review",
      mcpServers: [{ name: "sandbox-mcp" }],
      config: { iterationLimit: 10, compaction: { enabled: true } },
    });
    expect(spec.mcpServers[0]?.requireApprovalForTools).toEqual([]);
  });

  it("refuses a model name without a provider", () => {
    expect(() =>
      AgentSpecSchema.parse({
        model: { name: "glm" },
        instructions: "x",
        config: { iterationLimit: 1, compaction: { enabled: false } },
      }),
    ).toThrow();
  });

  it("refuses the TrueForge-only config keys", () => {
    expect(() =>
      AgentSpecSchema.parse({
        model: { name: "p/m" },
        instructions: "x",
        config: { iterationLimit: 1, compaction: { enabled: false }, sandbox: { enabled: false } },
      }),
    ).toThrow();
  });
});

describe("ModelProviderManifestSchema", () => {
  it("requires the window, the output cap and the reasoning flag per model", () => {
    expect(() =>
      ModelProviderManifestSchema.parse({
        name: "p",
        baseUrl: "http://x",
        apiKey: "k",
        models: [{ name: "m", modelId: "m-1" }],
      }),
    ).toThrow();
  });
});

describe("events", () => {
  it("round-trips every stored event type", () => {
    const events = [
      { ...base, type: "turn.created", turnId: "t1", previousTurnId: null, input: [] },
      {
        ...base,
        type: "turn.done",
        state: { status: "done", completedAt: "x", output: null, requiredActions: [] },
      },
      { ...base, type: "model.message", content: "hi" },
      {
        ...base,
        type: "thread.created",
        title: "tests",
        parent: { threadId: "main", toolCallId: "c1" },
        agentInfo: { type: "dynamic", name: "tests", input: "go" },
      },
      {
        ...base,
        type: "thread.done",
        title: "tests",
        parent: { threadId: "main", toolCallId: "c1" },
        state: { status: "error", error: "boom" },
      },
      { ...base, type: "tool.approval_required", toolCalls: [{ id: "c1", sourceEventId: "e0" }] },
      {
        ...base,
        type: "tool.response",
        toolCallId: "c1",
        toolName: "x",
        content: "",
        isError: false,
      },
    ];
    for (const event of events) expect(SessionEventSchema.parse(event)).toEqual(event);
  });

  it("streams deltas but does not store them", () => {
    const delta = { ...base, type: "model.message.delta", content: "h" };
    expect(StreamEventSchema.parse(delta)).toEqual(delta);
    expect(SessionEventSchema.safeParse(delta).success).toBe(false);
  });

  it("a deny needs a reason", () => {
    expect(
      TurnInputItemSchema.safeParse({
        type: "user.tool_approval",
        threadId: "main",
        toolCallId: "c1",
        approval: { status: "deny" },
      }).success,
    ).toBe(false);
  });
});
