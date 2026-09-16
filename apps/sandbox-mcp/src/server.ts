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
import { StagingError, type StagingStore } from "./stage";
import { registerSandboxTools } from "./tools";

export interface AppOptions {
  runtime: SandboxRuntime;
  log?: Logger;
  /**
   * Resolves when the runtime can provision. Until then `/healthz` is 503 and
   * so is `/mcp`: the local runtime builds its images at boot (decision 118),
   * and a `create` before that finishes would be a `docker run` of a tag that
   * does not exist yet, which Docker answers by trying to pull it from a
   * registry it was never on. Absent means ready.
   */
  ready?: Promise<void>;
  /**
   * Where a private repository's trees wait for their sandbox (decision 158).
   * Absent means `PUT /stage/...` is 404 and `sandbox_create` refuses a
   * `staged` ticket, which is what a deployment with no staging directory
   * wants to hear rather than a box with nothing in it.
   */
  stage?: StagingStore;
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

function createMcpServer(
  runtime: SandboxRuntime,
  log?: Logger,
  stage: StagingStore | null = null,
): McpServer {
  const server = new McpServer({ name: "cujo-sandbox-mcp", version: "0.1.0" });
  registerSandboxTools(server, runtime, log, stage);
  return server;
}

/** `PUT /stage/<ticket>/<base|head>`, a gzipped tar as the body, streamed. */
const STAGE_PATH = /^\/stage\/([^/]+)\/([^/]+)$/;

async function handleStage(
  req: IncomingMessage,
  res: ServerResponse,
  stage: StagingStore,
  ticket: string,
  tree: string,
  log: Logger,
): Promise<void> {
  if (req.method !== "PUT") {
    json(res, 405, { ok: false, error: "PUT" });
    return;
  }
  try {
    const { bytes } = await stage.put(ticket, tree, req);
    json(res, 201, { ok: true, bytes });
  } catch (error) {
    if (error instanceof StagingError) {
      const status = error.kind === "too_large" ? 413 : error.kind === "exists" ? 409 : 400;
      json(res, status, { ok: false, error: error.message });
      return;
    }
    log.error("stage.put.failed", errorFields(error));
    json(res, 500, { ok: false, error: "could not stage" });
  }
}

export function createApp(options: AppOptions) {
  const log = options.log ?? createLogger({ service: "sandbox-mcp" });
  // Sampled, never awaited on the request path: a healthcheck that hangs for
  // the length of a build is a healthcheck that times out.
  let ready = options.ready === undefined;
  void options.ready?.then(() => {
    ready = true;
  });
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      json(res, ready ? 200 : 503, {
        ok: ready,
        service: "sandbox-mcp",
        runtime: options.runtime.name,
        ...(ready ? {} : { reason: "not_ready" }),
      });
      return;
    }

    const staged = STAGE_PATH.exec(url.pathname);
    if (staged?.[1] !== undefined && staged[2] !== undefined && options.stage) {
      await handleStage(req, res, options.stage, staged[1], staged[2], log);
      return;
    }

    if (url.pathname !== "/mcp") {
      json(res, 404, { ok: false });
      return;
    }

    if (!ready) {
      json(res, 503, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "sandbox-mcp is not ready" },
        id: null,
      });
      return;
    }

    const mcp = createMcpServer(options.runtime, log, options.stage ?? null);
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
