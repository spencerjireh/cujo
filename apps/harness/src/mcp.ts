/**
 * The MCP bridge: every tool an MCP server lists becomes one pi tool of the
 * same name, so the model sees `post_gated_review` and `sandbox_exec` rather
 * than a `call_tool` meta-tool (decision 128). The server's JSON Schema is
 * handed to pi verbatim; pi compiles raw JSON Schema for validation and
 * forwards it unchanged as the provider's `function.parameters`.
 *
 * Both Cujo servers are stateless streamable-HTTP, so one client per session
 * is cheap and a reconnect is a new client.
 */

import type { McpServerManifest } from "@cujo/harness-contract";
import type { Logger } from "@cujo/log";
import { errorFields } from "@cujo/log";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface BridgedServer {
  name: string;
  tools: ToolDefinition[];
  close(): Promise<void>;
}

export interface BridgeOptions {
  /** Names that pause for a human; these run one at a time (decision 126). */
  gatedTools: readonly string[];
  log: Logger;
  /** Retry schedule for a server that is still booting (sandbox-mcp answers 503). */
  connectDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONNECT_DELAYS_MS = [
  1000, 2000, 5000, 10000, 20000, 30000, 30000, 30000, 30000, 30000,
];

/**
 * How long one tool call may take before the client gives up on it. The MCP
 * SDK's default is 60 seconds, which is shorter than a dependency install: the
 * first gated review on this harness lost both detonation attempts to
 * "Request timed out at tool layer". `sandbox_exec` accepts up to thirty
 * minutes and the sandbox enforces that itself, so the client waits one
 * minute past it; a review that hangs is ended by Cujo's own watchdog, not by
 * this. A tool that names its own `timeout_ms` gets that plus the minute.
 */
export const TOOL_CALL_TIMEOUT_MS = 31 * 60 * 1000;
const TOOL_CALL_MARGIN_MS = 60 * 1000;

export function callTimeoutMs(params: unknown): number {
  const named =
    params && typeof params === "object" && "timeout_ms" in params
      ? (params as { timeout_ms?: unknown }).timeout_ms
      : undefined;
  if (typeof named === "number" && Number.isFinite(named) && named > 0) {
    return Math.min(named + TOOL_CALL_MARGIN_MS, TOOL_CALL_TIMEOUT_MS);
  }
  return TOOL_CALL_TIMEOUT_MS;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function connectServer(
  manifest: McpServerManifest,
  options: BridgeOptions,
): Promise<BridgedServer> {
  const delays = options.connectDelaysMs ?? DEFAULT_CONNECT_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  let attempt = 0;
  for (;;) {
    const client = new Client({ name: "cujo-harness", version: "0.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(manifest.url)));
      const { tools } = await client.listTools();
      return {
        name: manifest.name,
        tools: tools.map((tool) => toolDefinitionOf(manifest.name, tool, client, options)),
        close: () => client.close(),
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      const delay = delays[attempt];
      if (delay === undefined) throw error;
      attempt += 1;
      options.log.warn("harness.mcp.connect.retried", {
        label: manifest.name,
        attempt,
        delay_ms: delay,
        ...errorFields(error),
      });
      await sleep(delay);
    }
  }
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: { type: "object"; [key: string]: unknown };
}

function toolDefinitionOf(
  serverName: string,
  tool: ListedTool,
  client: Pick<Client, "callTool">,
  options: Pick<BridgeOptions, "gatedTools">,
): ToolDefinition {
  const { $schema: _dropped, ...parameters } = tool.inputSchema;
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description ?? "",
    parameters: parameters as unknown as TSchema,
    ...(options.gatedTools.includes(tool.name) ? { executionMode: "sequential" as const } : {}),
    async execute(_toolCallId, params) {
      const result = await client.callTool(
        { name: tool.name, arguments: (params ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: callTimeoutMs(params) },
      );
      const text = textOf(result.content);
      // Throwing is the only way to mark a pi tool result as an error.
      if (result.isError) throw new Error(text || `${serverName}/${tool.name} failed`);
      return { content: [{ type: "text", text }], details: result.structuredContent ?? {} };
    },
  };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text")
    .map((part) => String((part as { text: unknown }).text))
    .join("");
}
