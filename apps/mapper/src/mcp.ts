/**
 * The bridge, off unless asked for (decision 172).
 *
 * The engine speaks MCP over stdio; every other MCP server here speaks
 * streamable HTTP, because that is what the harness and `apps/cujo` connect
 * to. This mounts one endpoint that forwards `tools/list` and `tools/call`
 * to a child running the engine's own MCP mode, so the review spec can carry
 * the engine's tools the day a slice wants them.
 *
 * It is behind `CUJO_MAPPER_MCP` and off by default, and nothing in this
 * repository calls it yet. That is deliberate: the HTTP routes are what the
 * review needs first, and a surface with no caller is a surface whose
 * mistakes nobody finds. Having the seam costs a file; discovering later
 * that the wrapper cannot expose the tools at all would cost the design.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@cujo/log";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface BridgeOptions {
  bin: string;
  cacheDir: string;
  allowedRoot: string;
  log: Logger;
}

/**
 * One child per request, as `sandbox-mcp` builds one server per request: the
 * engine's MCP mode starts a coordination daemon, and a daemon held open
 * across requests is a daemon whose lifetime nothing here owns.
 */
export function createBridge(
  options: BridgeOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const child = new StdioClientTransport({
      command: options.bin,
      args: [],
      env: {
        ...(process.env as Record<string, string>),
        CBM_CACHE_DIR: options.cacheDir,
        CBM_ALLOWED_ROOT: options.allowedRoot,
      },
    });
    const upstream = new Client({ name: "cujo-mapper-bridge", version: "0" });
    const server = new Server(
      { name: "cujo-mapper", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      upstream.callTool(request.params),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
      void upstream.close();
    });
    await upstream.connect(child);
    await server.connect(transport);
    const body = req.method === "POST" ? await readJson(req) : undefined;
    await transport.handleRequest(req, res, body);
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : undefined;
}
