/** A stateless streamable-HTTP MCP host for tests, shaped like the two Cujo servers. */

import { type Server, createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface Host {
  url: string;
  requests: number;
  ready: boolean;
  close(): Promise<void>;
}

export async function host(build: () => McpServer): Promise<Host> {
  const state = { requests: 0, ready: true };
  const server: Server = createServer(async (req, res) => {
    state.requests += 1;
    if (!state.ready) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "not ready" }, id: null }),
      );
      return;
    }
    const mcp = build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    get requests() {
      return state.requests;
    },
    get ready() {
      return state.ready;
    },
    set ready(value: boolean) {
      state.ready = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
