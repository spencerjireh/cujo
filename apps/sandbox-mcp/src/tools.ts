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
import type { StagingStore } from "./stage";

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
  staged: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional()
    .describe(
      "The `staged` ticket from the input block, when it has one: the base and " +
        "head trees of a private repository were fetched outside the sandbox and " +
        "are copied into this one under /work/stage. Single use. Pass it " +
        "verbatim and only from the input block; never compose one.",
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

/**
 * How much of one stream `sandbox_exec` hands back (decision 142).
 *
 * A tool result is context the model re-reads on every message after it, so
 * an unbounded `pytest -v` or a verbose install is paid for many times over.
 * Above the cap the head and the tail come back — a command's opening lines
 * say what ran, its closing lines say how it ended — and the whole output is
 * written into the box, where `sandbox_read_file` can fetch any of it on
 * purpose. The cap is well above what `sniff.py` prints: its reports are one
 * JSON line the sub-agent must copy verbatim, and a cut in their middle would
 * be a cut in the evidence.
 */
const EXEC_STREAM_CAP = 32 * 1024;
const EXEC_HEAD = 8 * 1024;
const EXEC_TAIL = 24 * 1024;
const EXEC_LOG_DIR = "/tmp/cujo-state/exec";
const EXEC_DESCRIPTION = [
  "Run one command as a list of arguments. No shell, so no pipelines, no",
  "redirection and no `&&`. Returns exit code, stdout, stderr and duration.",
  `A stream over ${EXEC_STREAM_CAP} bytes comes back as its head and tail with a`,
  "marker naming the file in the sandbox that holds all of it, unless it is one",
  "JSON object, which comes back whole.",
].join(" ");

/**
 * A stream that is one JSON object is a report, and a report is not clipped.
 *
 * `sniff.py` prints exactly one JSON object per command and bounds every
 * list in it itself (decision 146), so its size is already the sensors'
 * business; and the fold reads a check's envelope off this very result
 * (decision 147), where a head-and-tail cut would be a cut in the evidence.
 * Anything else — a test runner, an install log — is prose and is clipped.
 */
function isOneJsonObject(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    return typeof JSON.parse(trimmed) === "object";
  } catch {
    return false;
  }
}

/** Head and tail of a stream over the cap, with the marker between them. */
function clipped(text: string, total: number, path: string | null): string {
  const where = path ? `sandbox_read_file ${path} for the rest` : "the rest was not kept";
  return `${text.slice(0, EXEC_HEAD)}\n[cujo: truncated, ${total} bytes total; ${where}]\n${text.slice(-EXEC_TAIL)}`;
}

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
  stage: StagingStore | null = null,
): void {
  // Names the log files of clipped output; per process, which is enough
  // because the path only has to be unique within one box's lifetime.
  let execSerial = 0;
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
      // A private repository's trees (decision 158): taken from the staging
      // store before the box exists, released after, whatever happened. A
      // ticket nobody staged, or one already used, is a refusal and not a
      // box with an empty `/work/stage` that `prepare` would then report.
      const staged = args.staged ? await stage?.take(args.staged) : undefined;
      if (args.staged && !staged) {
        log.warn("stage.refused", { reason: stage ? "unknown_ticket" : "no_store" });
        return refusal("no staged trees under that ticket; it is unknown, used or expired");
      }
      try {
        const sandbox = await runtime.create({
          allowHosts: allow.hosts,
          ...(staged ? { staged: staged.trees } : {}),
        });
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
      } finally {
        await staged?.release();
      }
    },
  );

  server.registerTool(
    "sandbox_exec",
    {
      title: "Run a command in a sandbox",
      description: EXEC_DESCRIPTION,
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
        const serial = ++execSerial;
        const bound = async (stream: "stdout" | "stderr"): Promise<string> => {
          const text = result[stream];
          const total = Buffer.byteLength(text, "utf8");
          if (total <= EXEC_STREAM_CAP || isOneJsonObject(text)) return text;
          const path = `${EXEC_LOG_DIR}/${serial}-${stream}.log`;
          try {
            await runtime.writeFile(args.sandbox_id, path, text);
            log.info("sandbox.exec.clipped", { stream, bytes: total, path });
            return clipped(text, total, path);
          } catch (error) {
            // The clip still happens: a log that could not be written is a
            // reason to say so, not a reason to hand back the whole stream.
            log.warn("sandbox.exec.clip_unsaved", { stream, bytes: total, ...errorFields(error) });
            return clipped(text, total, null);
          }
        };
        return asToolResult({
          ok: true,
          exit_code: result.exitCode,
          stdout: await bound("stdout"),
          stderr: await bound("stderr"),
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
