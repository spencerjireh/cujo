import { CHECK_NAMES } from "@/lib/api/types";
import { check, cleanChecks, findings, review, run } from "@/lib/fixtures";

function fixture(index: number) {
  const finding = findings[index];
  if (!finding) throw new Error(`no fixture finding ${index}`);
  return finding;
}
import { buildLog, clockZero, offsetLabel } from "@/lib/run/log";
import { describe, expect, it } from "vitest";

describe("buildLog (decision 154)", () => {
  it("orders the entries by time: setup, the checks as they started, the review, the end", () => {
    const blocked = run({ status: "blocked" });
    const entries = buildLog(blocked);
    expect(entries.map((e) => (e.kind === "check" ? e.name : e.kind))).toEqual([
      "setup",
      "tests",
      "probes",
      "smoke",
      "detonation",
      "review",
      "end",
    ]);
    const tests = entries.find((e) => e.kind === "check" && e.name === "tests");
    if (!tests || tests.kind !== "check") throw new Error("no tests entry");
    // Measured from the turn's creation, which the fixture's setup names.
    const started = blocked.checks.find((c) => c.title === "tests")?.startedAt ?? "";
    expect(tests.at).toBe(Date.parse(started) - Date.parse(blocked.setup?.turnCreatedAt ?? ""));
    expect(tests.findings.map((f) => f.severity)).toEqual(["critical"]);
    expect(tests.wallMs).toBe(108_000);
  });

  it("gives each check its own findings, worst first, and the review the rest", () => {
    const diffRun = run({
      mode: "diff",
      checks: [],
      status: "clean",
      findings: [
        { ...fixture(2), check: "diff", severity: "info" },
        { ...fixture(1), check: "diff", severity: "warn" },
      ],
      review: review({ tool: "post_advisory_review" }),
    });
    const entries = buildLog(diffRun);
    expect(entries.map((e) => e.kind)).toEqual(["review", "end"]);
    const rev = entries[0];
    if (rev?.kind !== "review") throw new Error("no review");
    expect(rev.blocking).toBe(false);
    expect(rev.findings.map((f) => f.severity)).toEqual(["warn", "info"]);
  });

  it("keeps the fixed order for checks with no clock, and the last attempt for a retried name", () => {
    const retried = run({
      setup: null,
      checks: [
        check({ title: "smoke", startedAt: null, endedAt: null, error: "died", status: "error" }),
        check({ title: "smoke", startedAt: null, endedAt: null }),
        check({ title: "tests", startedAt: null, endedAt: null }),
      ],
    });
    const entries = buildLog(retried).filter((e) => e.kind === "check");
    expect(entries.map((e) => (e.kind === "check" ? e.name : ""))).toEqual(["tests", "smoke"]);
    const smoke = entries[1];
    if (smoke?.kind !== "check") throw new Error("no smoke");
    expect(smoke.attempts).toBe(2);
    expect(smoke.status).toBe("done");
    expect(smoke.at).toBeNull();
    expect(clockZero(retried)).toBeNull();
  });

  it("reads tokens per check from the ledger, summing attempts, and none without one", () => {
    const withLedger = run({
      ledger: {
        threads: [
          {
            title: "main",
            attempt: 1,
            messages: 3,
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: null,
            toolResultBytes: 0,
          },
          {
            title: "tests",
            attempt: 1,
            messages: 3,
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 5,
            cacheWriteTokens: 0,
            reasoningTokens: null,
            toolResultBytes: 0,
          },
          {
            title: "tests",
            attempt: 2,
            messages: 3,
            inputTokens: 50,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: null,
            toolResultBytes: 0,
          },
        ],
        largestToolResults: [],
      },
    });
    const tests = buildLog(withLedger).find((e) => e.kind === "check" && e.name === "tests");
    if (tests?.kind !== "check") throw new Error("no tests");
    expect(tests.tokens).toEqual({ input: 150, output: 15, cacheRead: 5 });
    const bare = buildLog(run({ ledger: null })).find((e) => e.kind === "check");
    if (bare?.kind !== "check") throw new Error("no check");
    expect(bare.tokens).toBeNull();
  });

  it("has no end while the run is live, and no setup for a diff review", () => {
    const live = buildLog(
      run({ status: "running", checks: cleanChecks, review: null, findings: [] }),
    );
    expect(live.at(-1)?.kind).toBe("check");
    expect(live[0]?.kind).toBe("setup");
    expect(CHECK_NAMES.length).toBe(4);
  });

  it("labels an offset the way the timeline speaks", () => {
    expect(offsetLabel(null)).toBeNull();
    expect(offsetLabel(0)).toBe("+0s");
    expect(offsetLabel(169_400)).toBe("+2m 49s");
  });
});
