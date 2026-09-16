/**
 * The sandbox service's tools from the trusted side (decision 161), against
 * an in-process MCP server that answers the way `sandbox-mcp` does: JSON in
 * a text part, a refusal as `isError` with a `problem`.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { SandboxMcp, SandboxMcpError } from "../../src/clients/sandbox-mcp";

const calls: { name: string; args: unknown }[] = [];

function answer(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

function mcp(): McpServer {
  const server = new McpServer({ name: "fake-sandbox", version: "0" });
  server.registerTool(
    "sandbox_create",
    { inputSchema: { allow_hosts: z.array(z.string()).optional(), staged: z.string().optional() } },
    async (args) => {
      calls.push({ name: "sandbox_create", args });
      if (args.staged === "bad") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, problem: "no staged trees under that ticket" }),
            },
          ],
        };
      }
      return answer({
        ok: true,
        sandbox_id: "sbx-9",
        provisioned_ms: 1500,
        allowed_hosts: args.allow_hosts ?? [],
      });
    },
  );
  server.registerTool(
    "sandbox_exec",
    {
      inputSchema: {
        sandbox_id: z.string(),
        argv: z.array(z.string()),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        timeout_ms: z.number().optional(),
      },
    },
    async (args) => {
      calls.push({ name: "sandbox_exec", args });
      if (args.argv[0] === "sleep") await new Promise((r) => setTimeout(r, 400));
      return answer({
        ok: true,
        exit_code: 0,
        stdout: `ran ${args.argv.join(" ")}`,
        stderr: "",
        duration_ms: 3,
        timed_out: false,
      });
    },
  );
  server.registerTool(
    "sandbox_destroy",
    { inputSchema: { sandbox_id: z.string() } },
    async (args) => {
      calls.push({ name: "sandbox_destroy", args });
      return answer({ ok: true });
    },
  );
  return server;
}

const http = createServer(async (req, res) => {
  const server = mcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  await transport.handleRequest(req, res, text ? JSON.parse(text) : undefined);
});
let url = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, () => resolve()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

describe("SandboxMcp", () => {
  it("creates a box and reads its id and provisioning time off the answer", async () => {
    const client = new SandboxMcp(url);
    expect(await client.create({ allowHosts: ["pypi.org"], staged: "0".repeat(32) })).toEqual({
      sandboxId: "sbx-9",
      provisionedMs: 1500,
    });
    expect(calls.at(-1)).toEqual({
      name: "sandbox_create",
      args: { allow_hosts: ["pypi.org"], staged: "0".repeat(32) },
    });
  });

  it("runs a command with its cwd, env and bound, and reads the result", async () => {
    const client = new SandboxMcp(url);
    const result = await client.exec("sbx-9", {
      argv: ["python3", "-V"],
      cwd: "/work/head",
      env: { A: "1" },
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      exitCode: 0,
      stdout: "ran python3 -V",
      stderr: "",
      durationMs: 3,
      timedOut: false,
    });
    expect(calls.at(-1)?.args).toEqual({
      sandbox_id: "sbx-9",
      argv: ["python3", "-V"],
      cwd: "/work/head",
      env: { A: "1" },
      timeout_ms: 5000,
    });
  });

  it("turns a refusal into an error carrying the service's own problem", async () => {
    const client = new SandboxMcp(url);
    const failure = await client.create({ allowHosts: [], staged: "bad" }).catch((e) => e);
    expect(failure).toBeInstanceOf(SandboxMcpError);
    expect(failure).toMatchObject({
      tool: "sandbox_create",
      problem: "no staged trees under that ticket",
    });
  });

  it("destroys a box", async () => {
    await new SandboxMcp(url).destroy("sbx-9");
    expect(calls.at(-1)).toEqual({ name: "sandbox_destroy", args: { sandbox_id: "sbx-9" } });
  });
});
