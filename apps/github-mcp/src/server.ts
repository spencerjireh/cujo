/**
 * HTTP surface: `/healthz` for the container healthcheck and `/mcp` for the
 * Streamable HTTP MCP transport. Stateless: every request gets a fresh
 * McpServer and transport, so the process holds no session table and a
 * restart loses nothing.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { GitHubClient } from "./github";
import { registerReviewTools } from "./tools";

export interface AppOptions {
  github: GitHubClient;
  /**
   * The public board this deployment links reviews to (decision 36). Held here
   * rather than taken from the agent, so the review footer can only ever point
   * at Cujo's own host. Empty means no deployment-wide board, and no review
   * carries a footer.
   */
  publicBaseUrl?: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? undefined : JSON.parse(text);
}

export function createMcpServer(github: GitHubClient, publicBaseUrl = ""): McpServer {
  const server = new McpServer({ name: "cujo-github-mcp", version: "0.1.0" });
  registerReviewTools(server, github, publicBaseUrl);
  return server;
}

export function createApp(options: AppOptions) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "github-mcp" });
      return;
    }

    if (url.pathname !== "/mcp") {
      json(res, 404, { ok: false });
      return;
    }

    const mcp = createMcpServer(options.github, options.publicBaseUrl ?? "");
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
      console.error("mcp request failed", error);
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
