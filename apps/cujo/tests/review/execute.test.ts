/**
 * The executor (decision 161): the exact commands it runs in the box for a
 * declared policy, in order, and what it makes of their answers.
 */
import { createLogger } from "@cujo/log";
import { describe, expect, it } from "vitest";
import type { ExecRequest, ExecResult } from "../../src/clients/sandbox-mcp";
import { executeDeclared } from "../../src/review/execute";
import type { Policy } from "../../src/review/policy";

interface Call {
  sandboxId: string;
  request: ExecRequest;
}

/** A sandbox that answers each sniff command the way `sniff.py` would. */
function fakeSandbox(
  over: { prepareOk?: boolean; headExit?: number; reportExit?: number; smokeBroken?: boolean } = {},
) {
  const calls: Call[] = [];
  const destroyed: string[] = [];
  const answer = (request: ExecRequest): ExecResult => {
    const argv = request.argv;
    const sub = argv[2];
    const done = (stdout: string, exitCode = 0): ExecResult => ({
      exitCode,
      stdout,
      stderr: "",
      durationMs: 5,
      timedOut: false,
    });
    if (sub === "prepare") {
      return over.prepareOk === false
        ? done(JSON.stringify({ ok: false, error: "git clone failed with exit 128" }), 1)
        : done(
            JSON.stringify({ ok: true, head: "/work/head", base: "/work/base", source: "clone" }),
          );
    }
    if (sub === "setup") {
      return done(
        JSON.stringify({
          ok: true,
          env: { HTTP_PROXY: "http://127.0.0.1:8899", CUJO_SANDBOX: "1" },
        }),
      );
    }
    if (sub === "run") {
      const tree = argv[argv.indexOf("--cwd") + 1];
      const check = argv[argv.indexOf("--check") + 1];
      if (check === "setup") return done(JSON.stringify({ check: "setup", exit: 0 }));
      const exit = tree === "/work/head" ? (over.headExit ?? 0) : 0;
      const tail =
        exit === 0 ? "3 passed" : "FAILED tests/test_total.py::test_bulk - assert\n1 failed";
      return done(JSON.stringify({ check, exit, stdout_tail: tail, stderr_tail: "" }));
    }
    if (sub === "detonate") {
      const dep = argv[argv.indexOf("--dependency") + 1];
      const cached = argv.includes("--cached");
      return done(
        JSON.stringify(
          cached
            ? { schema_version: 1, dependency: dep, source: "pypi", cached: true }
            : { schema_version: 1, dependency: dep, source: "pypi", install_ok: true },
        ),
      );
    }
    if (sub === "smoke") {
      if (over.smokeBroken) return done("smoke: a request is `METHOD /path`", 2);
      const tree = argv[argv.indexOf("--tree") + 1];
      const requests = argv.flatMap((a, i) => (a === "--request" ? [argv[i + 1]] : []));
      return done(
        JSON.stringify({
          tree,
          ready: true,
          port: 8000,
          stdout_tail: `${tree} booted`,
          stderr_tail: "",
          requests: requests.map((request) => ({
            request,
            status: tree === "head" && request === "GET /orders/1" ? 500 : 200,
            tail: tree === "head" ? "head body" : "base body",
          })),
        }),
      );
    }
    if (sub === "report") {
      const check = argv[argv.indexOf("--check") + 1];
      const extra = JSON.parse(argv[argv.indexOf("--extra") + 1] ?? "{}") as object;
      return done(
        JSON.stringify({
          ...extra,
          schema_version: 1,
          check,
          runs: [{ exit: 0 }, { exit: 1 }],
          derived: {},
        }),
        over.reportExit ?? 0,
      );
    }
    return done("", 127);
  };
  return {
    calls,
    destroyed,
    sandbox: {
      create: async () => ({ sandboxId: "sbx-1", provisionedMs: 900 }),
      exec: async (sandboxId: string, request: ExecRequest) => {
        calls.push({ sandboxId, request });
        return answer(request);
      },
      destroy: async (id: string) => {
        destroyed.push(id);
      },
    },
  };
}

const policy: Policy = {
  install: "pip install pytest",
  test: "python -m pytest -q",
  allowHosts: ["pypi.org"],
};
const input = {
  repo: "o/r",
  prNumber: 7,
  baseSha: "b".repeat(40),
  headSha: "h".repeat(40),
  cloneUrl: "https://github.com/o/r.git",
  staged: "",
};
const lines: Record<string, unknown>[] = [];
const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 8, 16, 10, 0, tick++));

describe("executeDeclared", () => {
  it("runs prepare, setup, head's install, head's tests and the report, and leaves base alone when head is clean", async () => {
    const box = fakeSandbox();
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      input,
      policy,
    );
    const argvs = box.calls.map((c) => c.request.argv.slice(2));
    expect(argvs[0]).toEqual([
      "prepare",
      "--clone-url",
      input.cloneUrl,
      "--head-sha",
      input.headSha,
      "--base-sha",
      input.baseSha,
      "--pr-number",
      "7",
      "--repo",
      "o/r",
    ]);
    expect(argvs[1]).toEqual(["setup", "--allow-host", "pypi.org"]);
    expect(argvs[2]).toEqual([
      "run",
      "--check",
      "setup",
      "--cwd",
      "/work/head",
      "--workspace-root",
      "/work/head",
      "--",
      "sh",
      "-c",
      "pip install pytest",
    ]);
    expect(argvs[3]).toEqual([
      "run",
      "--check",
      "tests",
      "--cwd",
      "/work/head",
      "--workspace-root",
      "/work/head",
      "--",
      "sh",
      "-c",
      "python -m pytest -q",
    ]);
    expect(argvs[4]?.slice(0, 4)).toEqual(["report", "--check", "tests", "--extra"]);
    // Base is never touched: a test head passed cannot be one head failed
    // (decision 169).
    expect(argvs.some((argv) => argv.includes("/work/base"))).toBe(false);
    // Every sensed command carries the env setup printed, and the box's id.
    for (const call of box.calls.slice(2)) {
      expect(call.sandboxId).toBe("sbx-1");
      expect(call.request.env).toEqual({ HTTP_PROXY: "http://127.0.0.1:8899", CUJO_SANDBOX: "1" });
    }
    expect(execution).toMatchObject({
      sandboxId: "sbx-1",
      provisionedMs: 900,
      env: { HTTP_PROXY: "http://127.0.0.1:8899" },
    });
    expect(execution.executed).toHaveLength(1);
    expect(execution.executed[0]).toMatchObject({
      check: "tests",
      report: {
        check: "tests",
        base: {},
        head: { suite: "pass" },
        base_pass_head_fail: [],
        base_not_run: true,
      },
    });
    expect(box.destroyed).toEqual([]);
    expect(lines.filter((l) => l.event === "execute.step")).toHaveLength(5);
    expect(lines.filter((l) => l.event === "execute.base.skipped")).toMatchObject([
      { check: "tests", reason: "head_clean" },
    ]);
  });

  it("installs and runs base once head fails, and names the regression head introduced", async () => {
    const box = fakeSandbox({ headExit: 1 });
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      input,
      policy,
    );
    // Head's install and suite, then base's, once head gave base something
    // to answer.
    const trees = box.calls
      .map((c) => c.request.argv)
      .filter((argv) => argv[2] === "run")
      .map((argv) => [argv[argv.indexOf("--check") + 1], argv[argv.indexOf("--cwd") + 1]]);
    expect(trees).toEqual([
      ["setup", "/work/head"],
      ["tests", "/work/head"],
      ["setup", "/work/base"],
      ["tests", "/work/base"],
    ]);
    expect(execution.executed[0]?.report).toMatchObject({
      base: { "tests/test_total.py::test_bulk": "pass" },
      head: { "tests/test_total.py::test_bulk": "fail" },
      base_pass_head_fail: ["tests/test_total.py::test_bulk"],
    });
    expect(execution.executed[0]?.report).not.toHaveProperty("base_not_run");
  });

  it("stages instead of cloning for a private run, and skips the install when none is declared", async () => {
    const box = fakeSandbox();
    await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      { ...input, staged: "0123456789abcdef0123456789abcdef" },
      { test: "pytest", allowHosts: [] },
    );
    expect(box.calls[0]?.request.argv.slice(2, 5)).toEqual(["prepare", "--staged", "/work/stage"]);
    expect(box.calls.map((c) => c.request.argv[2])).toEqual(["prepare", "setup", "run", "report"]);
  });

  it("destroys the box and throws when prepare fails, before any test runs", async () => {
    const box = fakeSandbox({ prepareOk: false });
    await expect(
      executeDeclared({ sandbox: box.sandbox, log, stepTimeoutMs: 1000, now }, input, policy),
    ).rejects.toThrow("prepare: git clone failed with exit 128");
    expect(box.destroyed).toEqual(["sbx-1"]);
    expect(box.calls).toHaveLength(1);
    expect(lines.find((l) => l.event === "execute.failed")).toBeDefined();
  });

  it("fails when the report itself did not come back", async () => {
    const box = fakeSandbox({ reportExit: 2 });
    await expect(
      executeDeclared({ sandbox: box.sandbox, log, stepTimeoutMs: 1000, now }, input, policy),
    ).rejects.toThrow("report tests");
    expect(box.destroyed).toEqual(["sbx-1"]);
  });

  it("boots the app on head then base when the policy declares it, and joins the endpoints", async () => {
    const box = fakeSandbox();
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      input,
      { ...policy, boot: "uvicorn app:app --port 8000", smoke: ["GET /health", "GET /orders/1"] },
    );
    const subs = box.calls.map((c) => c.request.argv[2]);
    expect(subs.slice(-3)).toEqual(["smoke", "smoke", "report"]);
    const smokes = box.calls
      .filter((c) => c.request.argv[2] === "smoke")
      .map((c) => c.request.argv);
    expect(smokes[0]).toEqual([
      "python3",
      "/opt/cujo/sniff.py",
      "smoke",
      "--boot",
      "uvicorn app:app --port 8000",
      "--request",
      "GET /health",
      "--request",
      "GET /orders/1",
      "--cwd",
      "/work/head",
      "--workspace-root",
      "/work/head",
      "--tree",
      "head",
    ]);
    expect(smokes[1]?.at(-1)).toBe("base");
    expect(execution.executed.map((e) => e.check)).toEqual(["tests", "smoke"]);
    expect(execution.executed[1]?.report).toMatchObject({
      check: "smoke",
      endpoints: [
        { request: "GET /health", base_status: 200, head_status: 200, head_tail: "head body" },
        { request: "GET /orders/1", base_status: 200, head_status: 500, head_tail: "head body" },
      ],
      log_tail: "head booted",
    });
  });

  it("leaves base unbooted when head served every request (decision 169)", async () => {
    const box = fakeSandbox();
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      input,
      { ...policy, boot: "uvicorn app:app --port 8000", smoke: ["GET /health"] },
    );
    const smokes = box.calls
      .filter((c) => c.request.argv[2] === "smoke")
      .map((c) => c.request.argv.at(-1));
    expect(smokes).toEqual(["head"]);
    expect(execution.executed[1]?.report).toMatchObject({
      check: "smoke",
      base_not_run: true,
      // A base that was never booted answers nothing, and the null says so.
      endpoints: [{ request: "GET /health", base_status: null, head_status: 200 }],
    });
    expect(lines.filter((l) => l.event === "execute.base.skipped").at(-1)).toMatchObject({
      check: "smoke",
      reason: "head_clean",
    });
  });

  it("fails the run when the smoke command itself did not answer", async () => {
    const box = fakeSandbox({ smokeBroken: true });
    await expect(
      executeDeclared({ sandbox: box.sandbox, log, stepTimeoutMs: 1000, now }, input, {
        ...policy,
        boot: "uvicorn app:app --port 8000",
        smoke: ["curl /x"],
      }),
    ).rejects.toThrow("smoke head");
    expect(box.destroyed).toEqual(["sbx-1"]);
  });

  it("detonates each added specifier before the install, stubbing the cached ones", async () => {
    const box = fakeSandbox();
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      {
        ...input,
        detonate: {
          added: [
            { source: "pypi", specifier: "requests==2.32.0" },
            { source: "pypi", specifier: "left-pad==1.0.0" },
          ],
          cached: [{ source: "pypi", dependency: "left-pad==1.0.0" }],
        },
      },
      policy,
    );
    const subs = box.calls.map((c) => c.request.argv[2]);
    expect(subs).toEqual([
      "prepare",
      "setup",
      "detonate",
      "detonate",
      "report",
      // Head's install and head's suite; base is not run for a clean head.
      "run",
      "run",
      "report",
    ]);
    const detonates = box.calls
      .filter((c) => c.request.argv[2] === "detonate")
      .map((c) => c.request.argv.slice(3));
    expect(detonates[0]).toEqual(["--dependency", "requests==2.32.0", "--source", "pypi"]);
    expect(detonates[1]).toEqual([
      "--dependency",
      "left-pad==1.0.0",
      "--source",
      "pypi",
      "--cached",
    ]);
    expect(execution.executed.map((e) => e.check)).toEqual(["detonation", "tests"]);
  });

  it("refuses a policy with no test command", async () => {
    const box = fakeSandbox();
    await expect(
      executeDeclared({ sandbox: box.sandbox, log, stepTimeoutMs: 1000, now }, input, {
        allowHosts: [],
      }),
    ).rejects.toThrow("no test command");
    expect(box.calls).toEqual([]);
  });
});
