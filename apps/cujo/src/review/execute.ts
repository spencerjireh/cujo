/**
 * The executor: a repository's declared commands, run in its sandbox with no
 * model (decision 161).
 *
 * Everything here is what the parent used to do in its setup steps and what
 * the `tests` sub-agent did after them, with the model taken out: provision
 * the box, `sniff.py prepare`, `sniff.py setup`, the declared install on
 * each tree, the declared test command on base and on head, and `sniff.py
 * report` for the Contract 2 envelope. The commands are the repository's own
 * lines from `.cujo.yml` at base, run under `sh -c` inside the box -- the
 * same strings the model passed through before, and nothing that was not
 * already the pull request's to choose. The report is what `sniff.py`
 * printed, whole, read off the command's own stdout (decision 147).
 *
 * The box is not torn down here. It is handed to the parent, prepared, for
 * probes and for the checks the executor does not run yet; the runner
 * destroys it when the turn ends. A failure before a report exists destroys
 * the box and throws, and the run fails with the reason before any session
 * is spent on it.
 */
import { type Logger, errorFields } from "@cujo/log";
import type { ExecResult, SandboxMcp } from "../clients/sandbox-mcp";
import type { ExecutedCheck } from "./fold";
import type { Policy } from "./policy";
import { suiteOutcome } from "./suite-outcome";

export interface ExecuteDeps {
  sandbox: Pick<SandboxMcp, "create" | "exec" | "destroy">;
  log: Logger;
  /** The bound on one install or test run. Prepare and setup have their own. */
  stepTimeoutMs: number;
  now?: () => Date;
}

export interface ExecuteInput {
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  /** The base repository's public clone URL, used when nothing was staged. */
  cloneUrl: string;
  /** The staging ticket of a private repository (decision 158), or "". */
  staged: string;
}

export interface Execution {
  sandboxId: string;
  provisionedMs: number;
  /** What `sniff.py setup` printed: the environment every later command carries. */
  env: Record<string, string>;
  executed: ExecutedCheck[];
}

class ExecuteError extends Error {
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(`${step}: ${detail}`);
    this.name = "ExecuteError";
  }
}

const SNIFF = ["python3", "/opt/cujo/sniff.py"] as const;
const HEAD = "/work/head";
const BASE = "/work/base";
const STAGE = "/work/stage";
/** Prepare and setup are bounded on their own: a clone, and two daemons. */
const PREPARE_TIMEOUT_MS = 5 * 60_000;
const SETUP_TIMEOUT_MS = 60_000;

export async function executeDeclared(
  deps: ExecuteDeps,
  input: ExecuteInput,
  policy: Policy,
): Promise<Execution> {
  if (!policy.test) throw new ExecuteError("policy", "no test command is declared");
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  deps.log.info("execute.started", { count: 1 + (policy.install ? 2 : 0) + 2 });
  const box = await deps.sandbox.create({
    allowHosts: policy.allowHosts,
    ...(input.staged ? { staged: input.staged } : {}),
  });
  try {
    const prepared = await sniff(deps, box.sandboxId, "prepare", {
      argv: [
        ...SNIFF,
        "prepare",
        ...(input.staged ? ["--staged", STAGE] : ["--clone-url", input.cloneUrl]),
        "--head-sha",
        input.headSha,
        "--base-sha",
        input.baseSha,
        "--pr-number",
        String(input.prNumber),
        "--repo",
        input.repo,
      ],
      timeoutMs: PREPARE_TIMEOUT_MS,
    });
    if (prepared.json?.ok !== true) {
      throw new ExecuteError("prepare", detailOf(prepared));
    }
    const setup = await sniff(deps, box.sandboxId, "setup", {
      argv: [...SNIFF, "setup", ...policy.allowHosts.flatMap((host) => ["--allow-host", host])],
      timeoutMs: SETUP_TIMEOUT_MS,
    });
    const env = envOf(setup.json);
    if (setup.json?.ok !== true || !env) throw new ExecuteError("setup", detailOf(setup));

    // The install, once per tree at the tree root, sensed under `--check
    // setup` so no check's report carries it (the rubric's own rule). A
    // non-zero exit is not the run's failure: it is what the tests will show.
    if (policy.install) {
      for (const tree of [BASE, HEAD]) {
        await sniff(deps, box.sandboxId, `install ${tree}`, {
          argv: [
            ...SNIFF,
            "run",
            "--check",
            "setup",
            "--cwd",
            tree,
            "--workspace-root",
            tree,
            "--",
            "sh",
            "-c",
            policy.install,
          ],
          cwd: tree,
          env,
          timeoutMs: deps.stepTimeoutMs,
        });
      }
    }

    const testsStartedAt = now().toISOString();
    const runs: Record<"base" | "head", ExecResult> = {
      base: await runSensed(deps, box.sandboxId, "tests", BASE, policy.test, env),
      head: await runSensed(deps, box.sandboxId, "tests", HEAD, policy.test, env),
    };
    // The extras the sub-agent used to write by reading the output, computed
    // here from the same output; `sniff.py report` spreads them under the
    // envelope's own keys, which nothing here can overwrite.
    const extra = suiteOutcome(
      { exit: runs.base.exitCode, stdout: runs.base.stdout, stderr: runs.base.stderr },
      { exit: runs.head.exitCode, stdout: runs.head.stdout, stderr: runs.head.stderr },
    );
    const reported = await sniff(deps, box.sandboxId, "report tests", {
      argv: [...SNIFF, "report", "--check", "tests", "--extra", JSON.stringify(extra)],
      env,
      timeoutMs: SETUP_TIMEOUT_MS,
    });
    if (reported.exitCode !== 0 || !reported.json) {
      throw new ExecuteError("report tests", detailOf(reported));
    }
    const execution: Execution = {
      sandboxId: box.sandboxId,
      provisionedMs: box.provisionedMs,
      env,
      executed: [
        {
          check: "tests",
          report: reported.json,
          startedAt: testsStartedAt,
          endedAt: now().toISOString(),
        },
      ],
    };
    deps.log.info("execute.finished", { duration_ms: Date.now() - started, count: 1 });
    return execution;
  } catch (error) {
    deps.log.error("execute.failed", { duration_ms: Date.now() - started, ...errorFields(error) });
    await deps.sandbox.destroy(box.sandboxId).catch((destroyError) => {
      deps.log.warn("sandbox.destroy.failed", {
        sandbox_id: box.sandboxId,
        ...errorFields(destroyError),
      });
    });
    throw error;
  }
}

/** The output of the wrapped command inside `sniff.py run`, as its report says. */
interface SniffResult extends ExecResult {
  /** The one JSON object the command printed, when it printed one. */
  json: Record<string, unknown> | null;
}

/** One sensed command on one tree: `sniff.py run --check <name> -- sh -c <line>`. */
async function runSensed(
  deps: ExecuteDeps,
  sandboxId: string,
  check: string,
  tree: string,
  line: string,
  env: Record<string, string>,
): Promise<ExecResult> {
  const result = await sniff(deps, sandboxId, `${check} ${tree}`, {
    argv: [
      ...SNIFF,
      "run",
      "--check",
      check,
      "--cwd",
      tree,
      "--workspace-root",
      tree,
      "--",
      "sh",
      "-c",
      line,
    ],
    cwd: tree,
    env,
    timeoutMs: deps.stepTimeoutMs,
  });
  // `sniff.py run` prints the wrapped command's report; the command's own
  // exit and output are inside it, and those are what the suite reader wants.
  const report = result.json;
  const exit = typeof report?.exit === "number" ? report.exit : result.exitCode;
  const stdout = typeof report?.stdout_tail === "string" ? report.stdout_tail : result.stdout;
  const stderr = typeof report?.stderr_tail === "string" ? report.stderr_tail : result.stderr;
  return { ...result, exitCode: exit, stdout, stderr };
}

/** One `sandbox_exec` of `sniff.py`, logged as a step, its stdout parsed when it is JSON. */
async function sniff(
  deps: ExecuteDeps,
  sandboxId: string,
  step: string,
  request: {
    argv: readonly string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<SniffResult> {
  const result = await deps.sandbox.exec(sandboxId, request);
  deps.log.info("execute.step", {
    step,
    exit_code: result.exitCode ?? -1,
    duration_ms: result.durationMs,
  });
  if (result.timedOut) throw new ExecuteError(step, `timed out after ${request.timeoutMs} ms`);
  return { ...result, json: oneJsonObject(result.stdout) };
}

function oneJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function envOf(json: Record<string, unknown> | null): Record<string, string> | null {
  const env = json?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Why a sniff command did not do its job, for the run's error: its own words first. */
function detailOf(result: SniffResult): string {
  const said = result.json?.error;
  if (typeof said === "string" && said.length > 0) return said;
  const tail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ");
  return `exit ${result.exitCode ?? "none"}${tail ? ` — ${tail.slice(0, 300)}` : ""}`;
}
