/**
 * The mapper's doors (decision 172). Two of them, and a third behind a
 * switch.
 *
 * Ingest takes the bytes and makes them a repository; `/slice` answers the
 * one question a review asks. The MCP bridge is off unless asked for: the
 * engine speaks MCP over stdio, this service speaks HTTP, and nothing
 * depends on the bridge yet -- it exists so the slice that wants the
 * engine's own tools on the review spec has somewhere to land.
 *
 * No route reads a credential, because there is none to read. What arrives
 * is a tarball of a pull request's own code, and what leaves is JSON about
 * it.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Server } from "node:http";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { Engine } from "./engine";
import { IngestError, type TreeStore, isKey, repoPath } from "./ingest";
import { type Slice, buildSlice } from "./slice";
import type { DiskStore } from "./store";

export interface AppOptions {
  engine: Engine;
  trees: TreeStore;
  disk: DiskStore;
  /** The directory holding every key; the engine is confined to it. */
  dir: string;
  log?: Logger;
  /** Mounted only when a composition asks for it. */
  mcp?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /**
   * Resolves once the engine has been seen to run. Until then every route
   * but the liveness pair answers 503, so a caller is told the service is
   * not yet usable rather than handed a failure per request.
   */
  ready?: Promise<unknown>;
}

const INGEST_PATH = /^\/ingest\/([^/]+)\/([^/]+)$/;
const INDEX_PATH = /^\/ingest\/([^/]+)\/index$/;

/** Bound on a JSON body; `/slice` takes a few hundred bytes and no more. */
const MAX_BODY_BYTES = 256 * 1024;

export function createApp(options: AppOptions): Server {
  const log = options.log ?? createLogger({ service: "mapper" });
  // Latched once rather than raced per request: "has this promise already
  // resolved" is not a question a promise can be asked.
  let ready = options.ready === undefined;
  options.ready?.then(
    () => {
      ready = true;
    },
    () => {
      ready = false;
    },
  );
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mapper");
    try {
      if (url.pathname === "/healthz") {
        json(res, 200, { ok: true, service: "mapper" });
        return;
      }
      if (url.pathname === "/readyz") {
        json(res, ready ? 200 : 503, {
          ok: ready,
          service: "mapper",
          ...(ready ? {} : { reason: "not_ready" }),
        });
        return;
      }
      if (!ready) {
        json(res, 503, { ok: false, error: "not_ready" });
        return;
      }

      const indexed = INDEX_PATH.exec(url.pathname);
      if (indexed?.[1] !== undefined) {
        await handleIndex(req, res, options, indexed[1], log);
        return;
      }

      const ingest = INGEST_PATH.exec(url.pathname);
      if (ingest?.[1] !== undefined && ingest[2] !== undefined) {
        await handleIngest(req, res, options, ingest[1], ingest[2], log);
        return;
      }

      if (url.pathname === "/slice") {
        await handleSlice(req, res, options, log);
        return;
      }

      if (url.pathname === "/mcp" && options.mcp) {
        await options.mcp(req, res);
        return;
      }

      json(res, 404, { ok: false, error: "no such route" });
    } catch (error) {
      log.error("mapper.request.failed", errorFields(error));
      if (!res.headersSent) json(res, 500, { ok: false, error: "failed" });
    }
  });
}

async function handleIngest(
  req: IncomingMessage,
  res: ServerResponse,
  options: AppOptions,
  key: string,
  tree: string,
  log: Logger,
): Promise<void> {
  if (req.method !== "PUT") {
    json(res, 405, { ok: false, error: "PUT" });
    return;
  }
  try {
    const { bytes } = await options.trees.put(key, tree, req);
    json(res, 201, { ok: true, bytes });
  } catch (error) {
    if (error instanceof IngestError) {
      json(res, statusOf(error), { ok: false, error: error.message });
      return;
    }
    log.error("ingest.put.failed", errorFields(error));
    json(res, 500, { ok: false, error: "could not ingest" });
  }
}

async function handleIndex(
  req: IncomingMessage,
  res: ServerResponse,
  options: AppOptions,
  key: string,
  log: Logger,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "POST" });
    return;
  }
  if (!isKey(key)) {
    json(res, 400, { ok: false, error: "key is not 32 hex characters" });
    return;
  }
  try {
    const { path, base, head } = await options.trees.materialise(key);
    const answer = await options.engine.run<IndexAnswer>("index_repository", {
      repo_path: path,
    });
    // The tarballs have done their work; the graph and the worktree are what
    // the queries read.
    await options.trees.dropArchives(key);
    // And now that this repository's real cost is on disk, the volume is
    // brought back under its cap — never at this key's own expense.
    const evicted = await options.disk.enforce(key);
    log.info("mapper.indexed", {
      count: answer.nodes ?? 0,
      bytes: answer.edges ?? 0,
      reason: answer.status ?? "indexed",
    });
    json(res, 200, {
      ok: true,
      project: answer.project ?? projectOf(options.dir, key),
      base,
      head,
      nodes: answer.nodes ?? 0,
      edges: answer.edges ?? 0,
      status: answer.status ?? "indexed",
      parse_partial: answer.parse_partial ?? null,
      evicted,
    });
  } catch (error) {
    if (error instanceof IngestError) {
      json(res, statusOf(error), { ok: false, error: error.message });
      return;
    }
    log.error("mapper.index.failed", errorFields(error));
    json(res, 500, { ok: false, error: "could not index" });
  }
}

async function handleSlice(
  req: IncomingMessage,
  res: ServerResponse,
  options: AppOptions,
  log: Logger,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "POST" });
    return;
  }
  let body: { project?: unknown; base?: unknown; depth?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    json(res, 400, { ok: false, error: "body is not JSON" });
    return;
  }
  if (typeof body.project !== "string" || typeof body.base !== "string") {
    json(res, 400, { ok: false, error: "project and base are required" });
    return;
  }
  try {
    const slice: Slice = await buildSlice(options.engine, {
      project: body.project,
      base: body.base,
      ...(typeof body.depth === "number" ? { depth: body.depth } : {}),
    });
    json(res, 200, { ok: true, ...slice });
  } catch (error) {
    log.error("mapper.slice.failed", errorFields(error));
    json(res, 500, { ok: false, error: "could not build a slice" });
  }
}

/** The engine names a project after the path it indexed; this is that name. */
function projectOf(dir: string, key: string): string {
  return repoPath(dir, key).replace(/^\//, "").replace(/\//g, "-");
}

function statusOf(error: IngestError): number {
  switch (error.kind) {
    case "too_large":
      return 413;
    case "exists":
      return 409;
    case "missing":
      return 404;
    default:
      return 400;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface IndexAnswer {
  project?: string;
  nodes?: number;
  edges?: number;
  status?: string;
  parse_partial?: unknown;
}
