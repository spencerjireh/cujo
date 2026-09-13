import { createLogger } from "@cujo/log";
import { type Tool, validateToolArguments } from "@earendil-works/pi-ai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerReviewTools } from "../../github-mcp/src/tools";
import { registerSandboxTools } from "../../sandbox-mcp/src/tools";
import {
  type BridgedServer,
  TOOL_CALL_TIMEOUT_MS,
  callTimeoutMs,
  connectServer,
  toolDefinitionOf,
} from "../src/mcp";
import { type Host, host } from "./mcp-host";

const log = createLogger({ service: "harness", level: "error", sink: () => undefined });
const hosts: Host[] = [];
const bridged: BridgedServer[] = [];
afterEach(async () => {
  for (const server of bridged.splice(0)) await server.close();
  for (const h of hosts.splice(0)) await h.close();
});

function echoServer(): McpServer {
  const server = new McpServer({ name: "echo", version: "0" });
  server.registerTool(
    "echo",
    {
      description: "Echoes.",
      inputSchema: { text: z.string(), times: z.number().int().positive().optional() },
    },
    async ({ text, times }) => ({
      content: [{ type: "text", text: text.repeat(times ?? 1) }],
      structuredContent: { text },
    }),
  );
  server.registerTool("fail", { description: "Fails.", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: "no such sandbox" }],
    isError: true,
  }));
  return server;
}

async function bridge(h: Host, gatedTools: string[] = [], delays: number[] = []) {
  const server = await connectServer(
    { name: "echo", url: h.url, description: "" },
    { gatedTools, log, connectDelaysMs: delays, sleep: async () => undefined },
  );
  bridged.push(server);
  return server;
}

describe("the MCP bridge", () => {
  it("exposes every listed tool under its own name with the server's schema", async () => {
    const h = await host(echoServer);
    hosts.push(h);
    const server = await bridge(h, ["fail"]);
    expect(server.tools.map((tool) => tool.name).sort()).toEqual(["echo", "fail"]);
    const echo = server.tools.find((tool) => tool.name === "echo");
    expect(echo?.description).toBe("Echoes.");
    expect((echo?.parameters as { properties: Record<string, unknown> }).properties).toHaveProperty(
      "text",
    );
    expect((echo?.parameters as Record<string, unknown>).$schema).toBeUndefined();
    expect(echo?.executionMode).toBeUndefined();
    expect(server.tools.find((tool) => tool.name === "fail")?.executionMode).toBe("sequential");
  });

  it("waits past the SDK's minute for a tool call, and past a named timeout", () => {
    expect(TOOL_CALL_TIMEOUT_MS).toBe(31 * 60 * 1000);
    expect(callTimeoutMs({})).toBe(TOOL_CALL_TIMEOUT_MS);
    expect(callTimeoutMs({ timeout_ms: 5 * 60 * 1000 })).toBe(6 * 60 * 1000);
    expect(callTimeoutMs({ timeout_ms: 40 * 60 * 1000 })).toBe(TOOL_CALL_TIMEOUT_MS);
    expect(callTimeoutMs({ timeout_ms: "x" })).toBe(TOOL_CALL_TIMEOUT_MS);
  });

  it("passes that timeout to the client on every call", async () => {
    const calls: unknown[][] = [];
    const client = {
      callTool: async (...args: unknown[]) => {
        calls.push(args);
        return { content: [{ type: "text", text: "ok" }] };
      },
    };
    const tool = toolDefinitionOf(
      "sandbox-mcp",
      { name: "sandbox_exec", inputSchema: { type: "object" } },
      client as never,
      { gatedTools: [] },
    );
    await tool.execute(
      "c1",
      { argv: ["sleep"], timeout_ms: 120_000 },
      undefined,
      undefined,
      {} as never,
    );
    expect(calls[0]?.[2]).toEqual({ timeout: 180_000 });
  });

  it("calls through and returns the text content", async () => {
    const h = await host(echoServer);
    hosts.push(h);
    const server = await bridge(h);
    const echo = server.tools.find((tool) => tool.name === "echo");
    const result = await echo?.execute(
      "c1",
      { text: "ab", times: 2 },
      undefined,
      undefined,
      {} as never,
    );
    expect(result?.content).toEqual([{ type: "text", text: "abab" }]);
    expect(result?.details).toEqual({ text: "ab" });
  });

  it("an MCP error result becomes a thrown error, which is pi's error result", async () => {
    const h = await host(echoServer);
    hosts.push(h);
    const server = await bridge(h);
    const fail = server.tools.find((tool) => tool.name === "fail");
    await expect(fail?.execute("c1", {}, undefined, undefined, {} as never)).rejects.toThrow(
      "no such sandbox",
    );
  });

  it("waits for a server that is still booting", async () => {
    const h = await host(echoServer);
    hosts.push(h);
    h.ready = false;
    setTimeout(() => {
      h.ready = true;
    }, 50);
    const server = await connectServer(
      { name: "echo", url: h.url, description: "" },
      {
        gatedTools: [],
        log,
        connectDelaysMs: [20, 20, 20, 20, 20],
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
    );
    bridged.push(server);
    expect(server.tools.length).toBe(2);
  });

  it("gives up after the schedule", async () => {
    const h = await host(echoServer);
    hosts.push(h);
    h.ready = false;
    await expect(bridge(h, [], [1, 1])).rejects.toThrow();
  });

  it("pi accepts the real github-mcp and sandbox-mcp schemas as tool parameters", async () => {
    const github = await host(() => {
      const server = new McpServer({ name: "cujo-github-mcp", version: "0" });
      registerReviewTools(server, {} as never, "", log);
      return server;
    });
    const sandbox = await host(() => {
      const server = new McpServer({ name: "cujo-sandbox-mcp", version: "0" });
      registerSandboxTools(server, {} as never, log);
      return server;
    });
    hosts.push(github, sandbox);
    const servers = [
      await connectServer(
        { name: "github-mcp", url: github.url, description: "" },
        { gatedTools: [], log, connectDelaysMs: [] },
      ),
      await connectServer(
        { name: "sandbox-mcp", url: sandbox.url, description: "" },
        { gatedTools: [], log, connectDelaysMs: [] },
      ),
    ];
    bridged.push(...servers);
    const names = servers.flatMap((server) => server.tools.map((tool) => tool.name));
    expect(names).toEqual([
      "post_advisory_review",
      "post_blocking_review",
      "sandbox_create",
      "sandbox_exec",
      "sandbox_write_file",
      "sandbox_read_file",
      "sandbox_destroy",
    ]);
    const samples: Record<string, unknown> = {
      post_advisory_review: {
        repo: "o/r",
        pr_number: 1,
        head_sha: "abcdef1",
        body: "Tests: fine.",
      },
      post_blocking_review: {
        repo: "o/r",
        pr_number: 1,
        head_sha: "abcdef1",
        body: "x",
        findings: [],
      },
      sandbox_create: { allow_hosts: ["github.com"] },
      sandbox_exec: { sandbox_id: "s", argv: ["ls"] },
      sandbox_write_file: { sandbox_id: "s", path: "/w/x", contents: "y" },
      sandbox_read_file: { sandbox_id: "s", path: "/w/x" },
      sandbox_destroy: { sandbox_id: "s" },
    };
    for (const definition of servers.flatMap((server) => server.tools)) {
      const tool: Tool = {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      };
      const args = samples[definition.name];
      expect(() =>
        validateToolArguments(tool, {
          type: "toolCall",
          id: "c",
          name: definition.name,
          arguments: args as Record<string, unknown>,
        }),
      ).not.toThrow();
      expect(() =>
        validateToolArguments(tool, {
          type: "toolCall",
          id: "c",
          name: definition.name,
          arguments: { bogus: 1 },
        }),
      ).toThrow();
    }
  });
});
