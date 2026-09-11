/**
 * HTTP surface: `/healthz` for the container healthcheck and `/mcp` for the
 * Streamable HTTP MCP transport.
 *
 * A copy of `github-mcp/src/server.ts` and deliberately a close one: two MCP
 * servers in one deployment that answer differently about transport, session
 * handling or errors is two things to learn instead of one.
 *
 * Stateless per request, like that one: a fresh `McpServer` and transport each
 * time, so the process holds no session table. The difference is that this
 * service *does* hold state — the sandboxes it provisioned live in the runtime —
 * and that state is indexed by an id the caller carries, so a request still needs
 * nothing remembered about it.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SandboxRuntime } from "./runtime";
import { registerSandboxTools } from "./tools";

export interface AppOptions {
  runtime: SandboxRuntime;
  log?: Logger;
}

/** A body bigger than this is not a tool call. `writeFile` is the widest caller. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Bounded rather than trusted. `github-mcp` buffers without a cap because
    // its widest input is a review body; a file write is larger and a cap here
    // is cheaper than finding the limit in a heap profile.
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? undefined : JSON.parse(text);
}

export function createMcpServer(runtime: SandboxRuntime, log?: Logger): McpServer {
  const server = new McpServer({ name: "cujo-sandbox-mcp", version: "0.1.0" });
  registerSandboxTools(server, runtime, log);
  return server;
}

export function createApp(options: AppOptions) {
  const log = options.log ?? createLogger({ service: "sandbox-mcp" });
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "sandbox-mcp", runtime: options.runtime.name });
      return;
    }

    if (url.pathname !== "/mcp") {
      json(res, 404, { ok: false });
      return;
    }

    const mcp = createMcpServer(options.runtime, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      const body = req.method === "POST" ? await readBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (error) {
      log.error("mcp.request.failed", { path: url.pathname, ...errorFields(error) });
      if (!res.headersSent) {
        json(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });
}
