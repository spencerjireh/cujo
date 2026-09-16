/**
 * The sandbox service's tools, called from the trusted side (decision 161).
 *
 * The harness reaches `sandbox-mcp` over MCP on the model's behalf; this is
 * the same door with no model in front of it, for the commands a repository
 * declared in its own `.cujo.yml`. What crosses is what the model used to
 * send: an allowlist, a ticket or a clone URL, and argv. The service takes
 * its inputs off the wire and cannot tell the two callers apart, which is
 * the point -- the box is provisioned, filtered and reaped exactly as before.
 *
 * One connection per call: the transport is stateless streamable HTTP, and a
 * client held open across a fifteen-minute test run is a client whose socket
 * something in between may have dropped.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface ExecRequest {
  argv: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Kill the command after this long. The service caps it at thirty minutes. */
  timeoutMs: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class SandboxMcpError extends Error {
  constructor(
    readonly tool: string,
    readonly problem: string,
  ) {
    super(`${tool}: ${problem}`);
    this.name = "SandboxMcpError";
  }
}

/** The service's own headroom over a command's timeout, as the harness allows. */
const CALL_HEADROOM_MS = 60_000;

export class SandboxMcp {
  constructor(
    private readonly url: string,
    private readonly connect: (url: string) => Promise<Client> = defaultConnect,
  ) {}

  async create(spec: {
    allowHosts: readonly string[];
    staged?: string;
  }): Promise<{ sandboxId: string; provisionedMs: number }> {
    const answer = await this.call(
      "sandbox_create",
      { allow_hosts: [...spec.allowHosts], ...(spec.staged ? { staged: spec.staged } : {}) },
      5 * 60_000,
    );
    const id = answer.sandbox_id;
    const ms = answer.provisioned_ms;
    if (typeof id !== "string" || id.length === 0) {
      throw new SandboxMcpError("sandbox_create", "answered with no sandbox id");
    }
    return { sandboxId: id, provisionedMs: typeof ms === "number" ? ms : 0 };
  }

  async exec(sandboxId: string, request: ExecRequest): Promise<ExecResult> {
    const answer = await this.call(
      "sandbox_exec",
      {
        sandbox_id: sandboxId,
        argv: [...request.argv],
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(request.env ? { env: request.env } : {}),
        timeout_ms: request.timeoutMs,
      },
      request.timeoutMs + CALL_HEADROOM_MS,
    );
    return {
      exitCode: typeof answer.exit_code === "number" ? answer.exit_code : null,
      stdout: typeof answer.stdout === "string" ? answer.stdout : "",
      stderr: typeof answer.stderr === "string" ? answer.stderr : "",
      durationMs: typeof answer.duration_ms === "number" ? answer.duration_ms : 0,
      timedOut: answer.timed_out === true,
    };
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.call("sandbox_destroy", { sandbox_id: sandboxId }, 2 * 60_000);
  }

  /** One tool call on a fresh connection; the JSON the service answers with. */
  private async call(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const client = await this.connect(this.url);
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: timeoutMs,
      });
      const text = textOf(result.content);
      if (result.isError) throw new SandboxMcpError(name, problemOf(text));
      try {
        const parsed = JSON.parse(text) as unknown;
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        throw new SandboxMcpError(name, "answered with something that is not JSON");
      }
    } finally {
      await client.close().catch(() => {});
    }
  }
}

async function defaultConnect(url: string): Promise<Client> {
  const client = new Client({ name: "cujo", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => {
      return (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      );
    })
    .map((part) => part.text)
    .join("\n");
}

/** A refusal's `problem`, or the raw text when it is not the service's shape. */
function problemOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { problem?: unknown };
    if (typeof parsed.problem === "string") return parsed.problem;
  } catch {
    // Not JSON: the text is the message.
  }
  return text.slice(0, 300) || "refused";
}
