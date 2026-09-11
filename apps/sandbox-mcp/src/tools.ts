/**
 * The tools the agent calls to get a sandbox and run in it.
 *
 * Modelled on `github-mcp/src/tools.ts`, including the two patterns that matter
 * more here than there, because every string a caller sends has been read out of
 * a pull request:
 *
 * - **An id, never a host.** `sandbox_id` is minted by the server and means
 *   nothing outside it. A caller that could name a host or a vendor handle could
 *   name a box somebody else is using.
 * - **Deployment config comes from this process's environment.** The image, the
 *   container runtime and the gateway image are never tool inputs. A sandbox
 *   whose image a caller chose is not a sandbox.
 *
 * Every field carries `.describe()`, because the descriptions are the prompt
 * surface — this is what the agent reads to decide what to call.
 */

import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateAllowlist } from "./allowlist";
import { SandboxError, type SandboxRuntime } from "./runtime";

/** Caps, so one tool call cannot hand a runtime an unbounded argument. */
const MAX_ARGV = 64;
const MAX_ARG_CHARS = 4096;
const MAX_PATH_CHARS = 1024;
const MAX_FILE_CHARS = 256 * 1024;
const MAX_ENV_PAIRS = 32;

const sandboxId = z
  .string()
  .min(1)
  .max(128)
  .describe("The id `sandbox_create` returned. Not a hostname and not a container name.");

const createShape = {
  allow_hosts: z
    .array(z.string().max(253))
    .max(32)
    .optional()
    .describe(
      "Hostnames this sandbox may reach, from the repository's own `.cujo.yml`. " +
        "Hostnames only: no scheme, port, path, CIDR or wildcard, each of which is " +
        "refused rather than trimmed. Everything else is blocked at the network " +
        "layer by a gateway the sandbox cannot reach.",
    ),
};

const execShape = {
  sandbox_id: sandboxId,
  argv: z
    .array(z.string().max(MAX_ARG_CHARS))
    .min(1)
    .max(MAX_ARGV)
    .describe(
      "The command as a list, program first. There is no shell: `cd x && y` is " +
        "not a command, and a pipeline is not one either. Use `cwd` to change " +
        "directory, and run the two halves of a pipeline as two calls.",
    ),
  cwd: z.string().max(MAX_PATH_CHARS).optional().describe("Absolute path to run in."),
  env: z
    .record(z.string().max(MAX_ARG_CHARS))
    .optional()
    .describe("Extra environment for this command only. Does not persist."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(30 * 60 * 1000)
    .optional()
    .describe("Kill the command after this long. The runtime's default applies when absent."),
};

const writeShape = {
  sandbox_id: sandboxId,
  path: z.string().max(MAX_PATH_CHARS).describe("Absolute path to write."),
  contents: z.string().max(MAX_FILE_CHARS).describe("The whole file's text."),
};

const readShape = {
  sandbox_id: sandboxId,
  path: z.string().max(MAX_PATH_CHARS).describe("Absolute path to read."),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_CHARS)
    .optional()
    .describe("Stop after this many bytes."),
};

const destroyShape = { sandbox_id: sandboxId };

function asToolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { ...(result as Record<string, unknown>) },
  };
}

/**
 * A refusal the model can act on.
 *
 * `isError` rather than a thrown exception, because a model that asked for
 * something impossible should be told what and try again — a transport error
 * tells it only that something broke.
 */
function refusal(problem: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, problem }) }],
  };
}

export function registerSandboxTools(
  server: McpServer,
  runtime: SandboxRuntime,
  log: Logger = createLogger({ service: "sandbox-mcp" }),
): void {
  server.registerTool(
    "sandbox_create",
    {
      title: "Create a sandbox",
      description:
        "Provision a disposable sandbox and return its id. Egress is denied by " +
        "default and only `allow_hosts` is permitted, enforced outside the " +
        "sandbox. Destroy it when the run is finished.",
      inputSchema: createShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      // Validated before any runtime sees it: this list configures a control on
      // the trusted side now, and it came from a repository (decision 116).
      const allow = validateAllowlist(args.allow_hosts);
      if (!allow.ok) {
        log.warn("sandbox.allowlist.refused", { reason: "invalid" });
        return refusal(allow.problem);
      }
      try {
        const sandbox = await runtime.create({ allowHosts: allow.hosts });
        return asToolResult({
          ok: true,
          sandbox_id: sandbox.id,
          // Carried back so the rubric can report it and `sandboxMs` stays an
          // honest number now that no harness event supplies one (decision 115).
          provisioned_ms: sandbox.provisionedMs,
          allowed_hosts: allow.hosts,
        });
      } catch (error) {
        log.error("sandbox.create.failed", errorFields(error));
        return refusal(error instanceof SandboxError ? error.message : "could not provision");
      }
    },
  );

  server.registerTool(
    "sandbox_exec",
    {
      title: "Run a command in a sandbox",
      description:
        "Run one command as a list of arguments. No shell, so no pipelines, no " +
        "redirection and no `&&`. Returns exit code, stdout, stderr and duration.",
      inputSchema: execShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      if (Object.keys(args.env ?? {}).length > MAX_ENV_PAIRS) {
        return refusal(`env holds more than ${MAX_ENV_PAIRS} entries`);
      }
      try {
        const result = await runtime.exec(args.sandbox_id, {
          argv: args.argv,
          cwd: args.cwd,
          env: args.env,
          timeoutMs: args.timeout_ms,
        });
        return asToolResult({
          ok: true,
          exit_code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration_ms: result.durationMs,
          timed_out: result.timedOut,
        });
      } catch (error) {
        log.error("sandbox.exec.failed", errorFields(error));
        return refusal(error instanceof SandboxError ? error.message : "could not run");
      }
    },
  );

  server.registerTool(
    "sandbox_write_file",
    {
      title: "Write a file in a sandbox",
      description: "Replace a file's contents. Creates it when it does not exist.",
      inputSchema: writeShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        await runtime.writeFile(args.sandbox_id, args.path, args.contents);
        return asToolResult({ ok: true });
      } catch (error) {
        log.error("sandbox.write.failed", errorFields(error));
        return refusal(error instanceof SandboxError ? error.message : "could not write");
      }
    },
  );

  server.registerTool(
    "sandbox_read_file",
    {
      title: "Read a file in a sandbox",
      description: "Read up to `max_bytes` of a file.",
      inputSchema: readShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const contents = await runtime.readFile(args.sandbox_id, args.path, args.max_bytes);
        return asToolResult({ ok: true, contents });
      } catch (error) {
        log.error("sandbox.read.failed", errorFields(error));
        return refusal(error instanceof SandboxError ? error.message : "could not read");
      }
    },
  );

  server.registerTool(
    "sandbox_destroy",
    {
      title: "Destroy a sandbox",
      description:
        "Remove the sandbox, its network and its egress gateway. Safe to call " +
        "twice; an id that is already gone is not an error.",
      inputSchema: destroyShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        await runtime.destroy(args.sandbox_id);
        return asToolResult({ ok: true });
      } catch (error) {
        log.error("sandbox.destroy.failed", errorFields(error));
        return refusal(error instanceof SandboxError ? error.message : "could not destroy");
      }
    },
  );
}
