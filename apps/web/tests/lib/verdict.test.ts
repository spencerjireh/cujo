import type { CheckState, Finding } from "@/lib/api/types";
import { checkVerdict, reportAlarm } from "@/lib/verdict";
import { describe, expect, it } from "vitest";

function check(over: Partial<CheckState> = {}): CheckState {
  return {
    title: "tests",
    isCheck: true,
    status: "done",
    report: null,
    error: null,
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    source: "agent",
    check: "tests",
    severity: "critical",
    title: "3 tests pass on base and fail on head",
    evidence: "",
    ...over,
  };
}

describe("reportAlarm", () => {
  it("is null when the report is not a sensor report", () => {
    expect(reportAlarm(null, "tests")).toBeNull();
    expect(reportAlarm({ notes: "hello" }, "tests")).toBeNull();
  });

  it("is null when a sensor report tripped nothing", () => {
    expect(
      reportAlarm({ egress: [], derived: { egress_to_unknown_host: false } }, "detonation"),
    ).toBeNull();
  });

  it("names the worst alarm on the block", () => {
    expect(
      reportAlarm(
        {
          secret_probe: { decoy_read: true },
          derived: { egress_to_unknown_host: true },
        },
        "detonation",
      ),
    ).toBe("decoy read");
    expect(reportAlarm({ derived: { egress_to_unknown_host: true } }, "detonation")).toBe(
      "unknown egress",
    );
    expect(
      reportAlarm({ secret_probe: { decoy_read: true, decoy_in_egress: true } }, "detonation"),
    ).toBe("decoy leaked");
  });

  it("names the worst alarm across the blocks, not the first block that tripped", () => {
    // The roll-up is parsed first and carries a warning; a run inside it
    // carries a critical. The lane says the critical.
    expect(
      reportAlarm(
        {
          derived: { wrote_outside_workspace: true },
          runs: [{ dependency: "tainted-sample", derived: { wrote_sensitive: true } }],
        },
        "detonation",
      ),
    ).toBe("sensitive write");
  });

  it("ranks unknown egress by the check it tripped on", () => {
    const report = { derived: { egress_to_unknown_host: true, wrote_sensitive: true } };
    expect(reportAlarm(report, "detonation")).toBe("unknown egress");
    expect(reportAlarm(report, "tests")).toBe("sensitive write");
  });

  it("reads the runs of a detonation report, not only the roll-up", () => {
    expect(
      reportAlarm(
        {
          egress: [],
          runs: [{ dependency: "tainted-sample", secret_probe: { decoy_read: true } }],
        },
        "detonation",
      ),
    ).toBe("decoy read");
  });
});

describe("checkVerdict", () => {
  it("says what a check that never ran is", () => {
    expect(checkVerdict(undefined, [], null)).toEqual({
      text: "not run",
      tone: "text-fg-muted",
    });
  });

  it("says running and error before it looks at anything else", () => {
    expect(checkVerdict(check({ status: "running" }), [finding()], "decoy read").text).toBe(
      "running",
    );
    expect(checkVerdict(check({ status: "error" }), [finding()], "decoy read")).toEqual({
      text: "error",
      tone: "text-sev-critical",
    });
  });

  it("counts the worst severity it found", () => {
    const findings = [
      finding(),
      finding({ title: "another" }),
      finding({ severity: "warn", title: "a warning" }),
    ];
    expect(checkVerdict(check(), findings, null)).toEqual({
      text: "2 critical",
      tone: "text-sev-critical",
    });
    expect(checkVerdict(check(), [finding({ severity: "warn" })], null)).toEqual({
      text: "1 warn",
      tone: "text-sev-high",
    });
    expect(checkVerdict(check(), [finding({ severity: "info" })], null).text).toBe("1 info");
  });

  it("counts only its own findings", () => {
    expect(checkVerdict(check(), [finding({ check: "smoke" })], null).text).toBe("ok");
  });

  it("names the sandbox alarm ahead of the count", () => {
    expect(checkVerdict(check({ title: "detonation" }), [], "decoy read")).toEqual({
      text: "decoy read",
      tone: "text-sev-high",
    });
    expect(
      checkVerdict(
        check({ title: "detonation" }),
        [finding({ check: "detonation" })],
        "decoy read",
      ),
    ).toEqual({ text: "decoy read", tone: "text-sev-critical" });
  });

  it("is ok when a check ran clean", () => {
    expect(checkVerdict(check(), [], null)).toEqual({ text: "ok", tone: "text-sev-info" });
  });
});
