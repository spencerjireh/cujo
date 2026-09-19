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
 * Smoke, when the policy declares `boot` (decision 162): `sniff.py smoke` boots
 * the app under the sensors on head then base, hits the declared requests,
 * stops it, and records one entry per tree; the `endpoints[]` and `log_tail`
 * extras are joined here from the two entries.
 *
 * Detonation, when the pull request changed a manifest (decision 163): each
 * added specifier is `sniff.py detonate`d in its own fresh environment, a
 * specifier this instance detonated within the week as a `--cached` stub
 * the fold replaces with the stored entry (decisions 145, 148), and the
 * `detonation` envelope is asked for like the others. Before the install,
 * since it needs the trees and the sensors and nothing else.
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
import { headIsClean, headOnlyOutcome, suiteOutcome } from "./suite-outcome";

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
  /**
   * What to detonate, when a manifest changed: the added specifiers, and the
   * ones the cache already holds, keyed the way the brief names them.
   */
  detonate?: {
    added: readonly { source: string; specifier: string }[];
    cached: readonly { source: string; dependency: string }[];
  };
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
  // What runs at least: setup, head's install when one is declared, head's
  // suite, and its report. Base doubles it only when head is not clean.
  deps.log.info("execute.started", { count: 1 + (policy.install ? 1 : 0) + 2 });
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

    const executed: ExecutedCheck[] = [];

    if (input.detonate && input.detonate.added.length > 0) {
      const detonationStartedAt = now().toISOString();
      const cachedKeys = new Set(
        input.detonate.cached.map((entry) => `${entry.source} ${entry.dependency}`),
      );
      for (const added of input.detonate.added) {
        const cached = cachedKeys.has(`${added.source} ${added.specifier}`);
        await sniff(deps, box.sandboxId, `detonate ${added.specifier}`, {
          argv: [
            ...SNIFF,
            "detonate",
            "--dependency",
            added.specifier,
            "--source",
            added.source,
            ...(cached ? ["--cached"] : []),
          ],
          env,
          timeoutMs: deps.stepTimeoutMs,
        });
      }
      const detonationReport = await sniff(deps, box.sandboxId, "report detonation", {
        argv: [...SNIFF, "report", "--check", "detonation"],
        env,
        timeoutMs: SETUP_TIMEOUT_MS,
      });
      if (detonationReport.exitCode !== 0 || !detonationReport.json) {
        throw new ExecuteError("report detonation", detailOf(detonationReport));
      }
      executed.push({
        check: "detonation",
        report: detonationReport.json,
        startedAt: detonationStartedAt,
        endedAt: now().toISOString(),
      });
    }

    /**
     * The install, at the tree root, sensed under `--check setup` so no
     * check's report carries it (the rubric's own rule).
     *
     * Its exit code is read, which for a week it was not (decision 173).
     * `sniff.py run` exits 0 whatever the wrapped command did — the command's
     * own exit is data inside the JSON it prints — and this discarded that
     * JSON, so an install that failed was indistinguishable from one that
     * worked. What the tests then showed was `vitest: not found`, which reads
     * exactly like a repository with no test runner.
     *
     * Answers with the wrapped command's own exit, or null when the policy
     * declares no install.
     */
    const install = async (tree: string): Promise<{ exit: number; tail: string } | null> => {
      if (!policy.install) return null;
      const result = await sniff(deps, box.sandboxId, `install ${tree}`, {
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
      const report = result.json;
      // The same unwrap `runSensed` does, for the same reason.
      const exit = typeof report?.exit === "number" ? report.exit : (result.exitCode ?? -1);
      const stderr = typeof report?.stderr_tail === "string" ? report.stderr_tail : result.stderr;
      const stdout = typeof report?.stdout_tail === "string" ? report.stdout_tail : result.stdout;
      deps.log.info("execute.install", { path: tree, exit_code: exit });
      return { exit, tail: lastLines(stderr || stdout) };
    };

    // Head first, and base only when head is not clean (decision 169). A
    // test head passed cannot be one head failed, so a clean head leaves
    // `base_pass_head_fail` empty whatever base would have said, and the
    // second install and second suite buy nothing.
    const testsStartedAt = now().toISOString();
    const headInstall = await install(HEAD);
    if (headInstall && headInstall.exit !== 0) {
      // Nothing downstream is worth measuring: a suite run against a tree
      // with no dependencies reports what the environment did, not what the
      // pull request did (decision 173).
      throw new ExecuteError(
        "install head",
        `the declared install exited ${headInstall.exit}: ${policy.install}${
          headInstall.tail ? ` -- ${headInstall.tail}` : ""
        }`,
      );
    }
    const head = await runSensed(deps, box.sandboxId, "tests", HEAD, policy.test, env);
    const headRun = { exit: head.exitCode, stdout: head.stdout, stderr: head.stderr };
    let extra: ReturnType<typeof suiteOutcome>;
    if (headIsClean(headRun)) {
      deps.log.info("execute.base.skipped", { check: "tests", reason: "head_clean" });
      extra = headOnlyOutcome(headRun);
    } else {
      const baseInstall = await install(BASE);
      if (baseInstall && baseInstall.exit !== 0) {
        // Not fatal, and deliberately so: a pull request whose whole purpose
        // is repairing a broken lockfile would otherwise end in error for
        // the very thing it fixes. Head's own evidence still stands; there
        // is simply nothing to compare it against (decision 173).
        deps.log.info("execute.base.skipped", { check: "tests", reason: "base_install_failed" });
        extra = { ...headOnlyOutcome(headRun), base_not_installed: true };
      } else {
        const base = await runSensed(deps, box.sandboxId, "tests", BASE, policy.test, env);
        // The extras the sub-agent used to write by reading the output,
        // computed here from the same output.
        extra = suiteOutcome(
          { exit: base.exitCode, stdout: base.stdout, stderr: base.stderr },
          headRun,
        );
      }
    }
    const reported = await sniff(deps, box.sandboxId, "report tests", {
      argv: [...SNIFF, "report", "--check", "tests"],
      env,
      timeoutMs: SETUP_TIMEOUT_MS,
    });
    if (reported.exitCode !== 0 || !reported.json) {
      throw new ExecuteError("report tests", detailOf(reported));
    }
    executed.push({
      check: "tests",
      report: merged(reported.json, extra),
      startedAt: testsStartedAt,
      endedAt: now().toISOString(),
    });

    if (policy.boot) {
      const smokeStartedAt = now().toISOString();
      const requests = policy.smoke ?? [];
      const entries: Record<"base" | "head", Record<string, unknown> | null> = {
        head: null,
        base: null,
      };
      // Head first, as the rubric had it: the tree under review first, so a
      // base that will not boot is a fact beside head's, not a wall in front
      // of it. And base only when head gives it something to say (decision
      // 169): base answers the question "was this already so before the
      // change", which a head that boots and answers everything does not
      // raise.
      const boot = async (tree: "head" | "base", path: string) => {
        const result = await sniff(deps, box.sandboxId, `smoke ${path}`, {
          argv: [
            ...SNIFF,
            "smoke",
            "--boot",
            policy.boot as string,
            ...requests.flatMap((request) => ["--request", request]),
            "--cwd",
            path,
            "--workspace-root",
            path,
            "--tree",
            tree,
          ],
          cwd: path,
          env,
          timeoutMs: deps.stepTimeoutMs,
        });
        // The command answers with its entry whatever the app did — a boot
        // that never listened is `ready: false` with the log — so no entry
        // is the command itself failing, and that is the run's failure.
        if (!result.json) throw new ExecuteError(`smoke ${tree}`, detailOf(result));
        entries[tree] = result.json;
      };
      await boot("head", HEAD);
      const headClean = smokeIsClean(entries.head, requests);
      if (headClean) {
        deps.log.info("execute.base.skipped", { check: "smoke", reason: "head_clean" });
      } else {
        await boot("base", BASE);
      }
      const smokeReport = await sniff(deps, box.sandboxId, "report smoke", {
        argv: [...SNIFF, "report", "--check", "smoke"],
        env,
        timeoutMs: SETUP_TIMEOUT_MS,
      });
      if (smokeReport.exitCode !== 0 || !smokeReport.json) {
        throw new ExecuteError("report smoke", detailOf(smokeReport));
      }
      executed.push({
        check: "smoke",
        report: merged(smokeReport.json, {
          ...smokeExtras(entries),
          ...(headClean ? { base_not_run: true } : {}),
        }),
        startedAt: smokeStartedAt,
        endedAt: now().toISOString(),
      });
    }

    const execution: Execution = {
      sandboxId: box.sandboxId,
      provisionedMs: box.provisionedMs,
      env,
      executed,
    };
    deps.log.info("execute.finished", {
      duration_ms: Date.now() - started,
      count: executed.length,
    });
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

/**
 * The smoke extras the rubric documents, from the two trees' entries: one
 * `endpoints[]` row per request, joined by the request string, with `null`
 * for a side that never answered so "not observed" stays distinguishable;
 * `log_tail` is head's boot output, the tree under review.
 */
/**
 * Whether head's boot leaves base nothing to answer (decision 169).
 *
 * Base is there to say whether a failure is the change's or the fixture's,
 * so it is worth booting only when head failed something: it did not come
 * up, or a declared request went unanswered or came back an error. A head
 * that served every request is not a comparison anyone reads.
 */
function smokeIsClean(head: Record<string, unknown> | null, requests: readonly string[]): boolean {
  if (head?.ready !== true) return false;
  const rows = Array.isArray(head.requests) ? (head.requests as Record<string, unknown>[]) : [];
  const answered = new Map(rows.map((row) => [String(row.request ?? ""), row]));
  return requests.every((request) => {
    const status = answered.get(request)?.status;
    return typeof status === "number" && status < 400;
  });
}

function smokeExtras(entries: {
  head: Record<string, unknown> | null;
  base: Record<string, unknown> | null;
}): { endpoints: Record<string, unknown>[]; log_tail: string } {
  const rows = (entry: Record<string, unknown> | null) =>
    Array.isArray(entry?.requests) ? (entry.requests as Record<string, unknown>[]) : [];
  const byRequest = (entry: Record<string, unknown> | null) =>
    new Map(rows(entry).map((row) => [String(row.request ?? ""), row]));
  const head = byRequest(entries.head);
  const base = byRequest(entries.base);
  const requests = [...new Set([...head.keys(), ...base.keys()])];
  const status = (row: Record<string, unknown> | undefined) =>
    typeof row?.status === "number" ? row.status : null;
  return {
    endpoints: requests.map((request) => ({
      request,
      base_status: status(base.get(request)),
      head_status: status(head.get(request)),
      head_tail: typeof head.get(request)?.tail === "string" ? head.get(request)?.tail : "",
    })),
    log_tail: [entries.head?.stdout_tail, entries.head?.stderr_tail]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n"),
  };
}

/**
 * The envelope with this check's extras under it (decision 173).
 *
 * These used to ride into the box as one argument to `sniff.py report`, and
 * `sandbox-mcp` caps every argv element at 4096 characters — which a real
 * test suite passes without trying, and a smoke run with a chatty boot log
 * passes twice over. The executor already holds the envelope and the extras;
 * merging them here means the payload never crosses a boundary that has a
 * limit, rather than being made to fit one.
 *
 * `--extra` stays on `sniff.py` for the gather path, where a check sub-agent
 * writes the extras and an argument is the only door it has.
 *
 * Spread in the same order `cmd_report` uses, so the envelope's own keys —
 * `check`, `runs`, `derived`, `schema_version` — still win, and the extras
 * still cannot overwrite what the sensors observed.
 */
function merged(envelope: Record<string, unknown>, extra: object): Record<string, unknown> {
  return { ...extra, ...envelope };
}

/** The tail of a failure, short enough for a run's error line. */
function lastLines(text: string, lines = 3, max = 400): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join(" | ").trim();
  return kept.length > max ? `${kept.slice(0, max)}...` : kept;
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
