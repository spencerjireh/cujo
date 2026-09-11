/**
 * Daytona, as one implementation of `SandboxRuntime` rather than as its shape.
 *
 * Kept so the move off the harness's sandbox provider is reversible on one
 * environment variable, which is what makes it worth doing at all (decision
 * 113). Nothing else in this app knows the vendor exists.
 *
 * Over its REST API with an injected `fetch`, not its SDK. The repo has no
 * Daytona dependency today and adding one to hold four calls is a pin to carry
 * for nothing; `GitHubReader` talks to GitHub exactly this way, and injecting
 * `fetch` is what lets the tests run with no network and no key.
 *
 * **This runtime cannot enforce egress**, and that is the whole reason the local
 * one exists. Tier one gives no sandbox-level network policy, so on this
 * implementation the in-sandbox proxy is still the only thing between the code
 * and the internet — a control on the wrong side of the boundary it enforces.
 * `allowHosts` is therefore recorded and passed inward rather than applied here,
 * and the log says so on every create, so a deployment running this cannot
 * believe it has the property the local runtime has.
 */

import { type Logger, createLogger } from "@cujo/log";
import {
  type ExecRequest,
  type ExecResult,
  type Sandbox,
  SandboxError,
  type SandboxRuntime,
  type SandboxSpec,
} from "../runtime";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DaytonaRuntimeOptions {
  apiUrl: string;
  apiKey: string;
  /** The snapshot or image this deployment runs. Never a caller's. */
  image?: string;
  fetchImpl?: FetchLike;
  log?: Logger;
}

const DEFAULT_EXEC_TIMEOUT_MS = 20 * 60 * 1000;

export class DaytonaRuntime implements SandboxRuntime {
  readonly name = "daytona";
  /** The vendor handle for each id this process minted. Never published. */
  private readonly handles = new Map<string, string>();
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger;

  constructor(private readonly options: DaytonaRuntimeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? createLogger({ service: "sandbox-mcp" });
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchImpl(`${this.options.apiUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      // The status and the path, never the body: an upstream body can carry a
      // key back, and this message reaches a log.
      throw new SandboxError(
        "provision_failed",
        `daytona ${init.method ?? "GET"} ${path} -> ${res.status}`,
      );
    }
    return res.status === 204 ? null : await res.json();
  }

  private handle(id: string): string {
    const handle = this.handles.get(id);
    if (!handle) throw new SandboxError("no_such_sandbox", "no such sandbox");
    return handle;
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const body = await this.call("/sandbox", {
      method: "POST",
      body: JSON.stringify(this.options.image ? { snapshot: this.options.image } : {}),
    });
    const handle = (body as { id?: unknown } | null)?.id;
    if (typeof handle !== "string" || handle.length === 0) {
      throw new SandboxError("provision_failed", "daytona returned no sandbox id");
    }
    // A minted id, so the vendor's handle never crosses back to a caller whose
    // input came out of a pull request.
    const id = `dtn-${handle.slice(0, 8)}-${Date.now().toString(36)}`;
    this.handles.set(id, handle);
    // Warned on every create, not once at boot: a deployment running this
    // runtime must not be able to believe it has the property the local one has.
    // The in-sandbox proxy is still the only thing between the code and the
    // internet here, which is a control on the wrong side of its own boundary.
    this.log.warn("sandbox.egress.unenforced", {
      reason: "runtime_has_no_network_policy",
      limit: spec.allowHosts.length,
    });
    return { id, provisionedMs: Date.now() - started };
  }

  async exec(id: string, request: ExecRequest): Promise<ExecResult> {
    const started = Date.now();
    if (request.argv.length === 0) throw new SandboxError("refused", "argv is empty");
    const body = (await this.call(`/sandbox/${this.handle(id)}/toolbox/process/execute`, {
      method: "POST",
      body: JSON.stringify({
        // argv as a list, so nothing in it is parsed by a shell on the far side.
        command: request.argv,
        cwd: request.cwd,
        env: request.env,
        timeout: Math.ceil((request.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS) / 1000),
      }),
    })) as { exitCode?: number; result?: string; stdout?: string; stderr?: string } | null;
    return {
      exitCode: typeof body?.exitCode === "number" ? body.exitCode : null,
      stdout: body?.stdout ?? body?.result ?? "",
      stderr: body?.stderr ?? "",
      durationMs: Date.now() - started,
      // The API reports a timeout as a non-zero exit, so this cannot be told
      // apart here. Stated rather than guessed.
      timedOut: false,
    };
  }

  async writeFile(id: string, path: string, contents: string): Promise<void> {
    await this.call(
      `/sandbox/${this.handle(id)}/toolbox/files/upload?path=${encodeURIComponent(path)}`,
      { method: "POST", body: JSON.stringify({ content: contents }) },
    );
  }

  async readFile(id: string, path: string, maxBytes = 1024 * 1024): Promise<string> {
    const body = (await this.call(
      `/sandbox/${this.handle(id)}/toolbox/files/download?path=${encodeURIComponent(path)}`,
    )) as { content?: string } | null;
    return (body?.content ?? "").slice(0, maxBytes);
  }

  async destroy(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    this.handles.delete(id);
    await this.call(`/sandbox/${handle}`, { method: "DELETE" });
  }
}
