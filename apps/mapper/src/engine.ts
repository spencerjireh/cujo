/**
 * The one place that runs the engine (decision 172).
 *
 * `codebase-memory-mcp` is a C binary that speaks MCP over stdio and offers
 * the same tools as one-shot CLI commands. This service uses the CLI form
 * exclusively: a one-shot runs a tool and exits, holding nothing but an OS
 * admission lease for its own lifetime, where the MCP form starts a
 * coordination daemon that owns watchers, shared indexing jobs and an
 * account-wide barrier. A daemon is the wrong shape inside a container that
 * indexes one tree and is done.
 *
 * Every call is `cbm cli <tool> --format json`, arguments as flags, and the
 * answer parsed from stdout. Progress and logs go to stderr and never
 * contaminate the payload.
 */

import { spawn } from "node:child_process";
import type { Logger } from "@cujo/log";

export interface EngineOptions {
  /** Path to the binary; the image installs it in `/usr/local/bin`. */
  bin: string;
  /** Where the engine keeps its graphs. The volume, never the tree. */
  cacheDir: string;
  /**
   * The engine refuses a `repo_path` that resolves outside this directory,
   * symlinks and `..` included. Belt to this service's own checks, and the
   * knob the engine documents for exactly this: a server driven by a caller
   * it does not trust.
   */
  allowedRoot: string;
  /** Kill a tool that has not answered by then. */
  timeoutMs: number;
  log: Logger;
}

export class EngineError extends Error {
  constructor(
    readonly tool: string,
    readonly code: number | null,
    detail: string,
  ) {
    super(`${tool}: ${detail}`);
    this.name = "EngineError";
  }
}

/**
 * The tools that answer in JSON and refuse to be told so. `--format` is
 * generated per tool from its input schema, and `index_repository` has none —
 * passing it is an error, not a no-op. Found by the live test against the
 * real binary, which is the only thing that could have found it.
 */
const ALREADY_JSON = new Set(["index_repository"]);

/** One tool's arguments, as the engine's generated flags take them. */
export type EngineArgs = Record<string, string | number | boolean | undefined>;

export class Engine {
  constructor(private readonly options: EngineOptions) {}

  /**
   * The engine's version string, and the proof that it runs at all. Not a
   * tool call: `--version` touches no graph and no volume, so it says
   * exactly one thing -- this binary executes on this machine.
   */
  async version(): Promise<string> {
    const { code, stdout, stderr, timedOut } = await this.spawn(["--version"]);
    if (timedOut) throw new EngineError("--version", null, "did not answer");
    if (code !== 0) throw new EngineError("--version", code, firstLine(stderr) || `exited ${code}`);
    return stdout.trim().slice(0, 120);
  }

  /** Run one tool and parse its JSON. Rejects on a non-zero exit. */
  async run<T = Record<string, unknown>>(tool: string, args: EngineArgs = {}): Promise<T> {
    const format = ALREADY_JSON.has(tool) ? [] : ["--format", "json"];
    const argv = ["cli", "--quiet", tool, ...format, ...flagsOf(args)];
    const started = Date.now();
    const { code, stdout, stderr, timedOut } = await this.spawn(argv);
    const durationMs = Date.now() - started;
    if (timedOut) throw new EngineError(tool, null, `no answer in ${this.options.timeoutMs} ms`);
    if (code !== 0) {
      throw new EngineError(tool, code, firstLine(stderr) || `exited ${code}`);
    }
    this.options.log.info("engine.ran", { tool, duration_ms: durationMs, bytes: stdout.length });
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new EngineError(tool, code, "answered with something that is not JSON");
    }
  }

  private spawn(
    argv: readonly string[],
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.bin, [...argv], {
        env: {
          ...process.env,
          CBM_CACHE_DIR: this.options.cacheDir,
          CBM_ALLOWED_ROOT: this.options.allowedRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: {
        code: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // The timeout answers immediately rather than killing and waiting for
      // `close`. The engine starts a supervised worker for an index and the
      // worker inherits this pipe, so a killed engine can leave `close`
      // pending behind a grandchild that outlives it -- which would make the
      // bound this timer exists to impose no bound at all.
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ code: null, stdout, stderr, timedOut: true });
      }, this.options.timeoutMs);
      timer.unref();
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        // Bounded: the engine is chatty under --progress and nothing here
        // reads more than the first line of it.
        if (stderr.length < 8192) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (code) => {
        finish({ code, stdout, stderr, timedOut: false });
      });
    });
  }
}

function flagsOf(args: EngineArgs): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === false) continue;
    const flag = `--${key.replace(/_/g, "-")}`;
    if (value === true) {
      out.push(flag);
      continue;
    }
    out.push(flag, String(value));
  }
  return out;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim()
      .slice(0, 300) ?? ""
  );
}
