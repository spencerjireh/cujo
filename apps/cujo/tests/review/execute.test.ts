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
function fakeSandbox(over: { prepareOk?: boolean; headExit?: number; reportExit?: number } = {}) {
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
    if (sub === "smoke") {
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
  it("runs prepare, setup, the install on each tree, the tests on base then head, and the report", async () => {
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
      "/work/base",
      "--workspace-root",
      "/work/base",
      "--",
      "sh",
      "-c",
      "pip install pytest",
    ]);
    expect(argvs[3]?.[4]).toBe("/work/head");
    expect(argvs[4]).toEqual([
      "run",
      "--check",
      "tests",
      "--cwd",
      "/work/base",
      "--workspace-root",
      "/work/base",
      "--",
      "sh",
      "-c",
      "python -m pytest -q",
    ]);
    expect(argvs[5]?.[4]).toBe("/work/head");
    expect(argvs[6]?.slice(0, 4)).toEqual(["report", "--check", "tests", "--extra"]);
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
      report: { check: "tests", base_pass_head_fail: [] },
    });
    expect(box.destroyed).toEqual([]);
    expect(lines.filter((l) => l.event === "execute.step")).toHaveLength(7);
  });

  it("names the regression the head introduced in the report's extras", async () => {
    const box = fakeSandbox({ headExit: 1 });
    const execution = await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      input,
      policy,
    );
    expect(execution.executed[0]?.report).toMatchObject({
      base: { "tests/test_total.py::test_bulk": "pass" },
      head: { "tests/test_total.py::test_bulk": "fail" },
      base_pass_head_fail: ["tests/test_total.py::test_bulk"],
    });
  });

  it("stages instead of cloning for a private run, and skips the install when none is declared", async () => {
    const box = fakeSandbox();
    await executeDeclared(
      { sandbox: box.sandbox, log, stepTimeoutMs: 1000, now },
      { ...input, staged: "0123456789abcdef0123456789abcdef" },
      { test: "pytest", allowHosts: [] },
    );
    expect(box.calls[0]?.request.argv.slice(2, 5)).toEqual(["prepare", "--staged", "/work/stage"]);
    expect(box.calls.map((c) => c.request.argv[2])).toEqual([
      "prepare",
      "setup",
      "run",
      "run",
      "report",
    ]);
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
