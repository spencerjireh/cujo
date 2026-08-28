import { describe, expect, it } from "vitest";
import { agentFindings, hardRuleFindings, mergeFindings, missingCheckFindings } from "./findings";
import type { CheckState, DraftedReview, Finding } from "./types";

const check = (title: string, report: unknown, isCheck = true): CheckState => ({
  threadId: `th-${title}`,
  title,
  isCheck,
  startedAt: null,
  endedAt: null,
  status: "done",
  report,
  error: null,
});

describe("hardRuleFindings", () => {
  it("is empty for clean reports, missing fields, and non-check threads", () => {
    expect(hardRuleFindings([])).toEqual([]);
    expect(hardRuleFindings([check("tests", { base_pass_head_fail: [] })])).toEqual([]);
    expect(hardRuleFindings([check("tests", { derived: {} })])).toEqual([]);
    expect(hardRuleFindings([check("tests", null)])).toEqual([]);
    expect(hardRuleFindings([check("tests", "prose")])).toEqual([]);
    expect(
      hardRuleFindings([check("helper", { secret_probe: { decoy_read: true } }, false)]),
    ).toEqual([]);
  });

  it("trips on a regression the tests caught", () => {
    const [f] = hardRuleFindings([check("tests", { base_pass_head_fail: ["a::t1", "a::t2"] })]);
    expect(f).toMatchObject({
      source: "hard_rule",
      check: "tests",
      severity: "critical",
      title: "2 tests pass on base and fail on head",
      evidence: "a::t1, a::t2",
    });
  });

  it("trips on a decoy read or leak on any check, at the top level or inside a run", () => {
    const top = hardRuleFindings([check("probes", { secret_probe: { decoy_read: true } })]);
    expect(top.map((f) => f.title)).toEqual(["the seeded decoy secret was read during probes"]);
    const nested = hardRuleFindings([
      check("smoke", {
        runs: [
          { secret_probe: { decoy_read: false } },
          { secret_probe: { decoy_in_egress: true } },
        ],
      }),
    ]);
    expect(nested.map((f) => f.title)).toEqual([
      "the seeded decoy secret left the sandbox during smoke",
    ]);
  });

  it("trips on a sensitive write and cites the paths", () => {
    const [f] = hardRuleFindings([
      check("tests", {
        derived: { wrote_sensitive: true },
        fs_changes: [
          { path: "~/.ssh/authorized_keys", sensitive: true },
          { path: "~/work/x", sensitive: false },
        ],
      }),
    ]);
    expect(f?.evidence).toBe("~/.ssh/authorized_keys");
  });

  it("trips on unknown-host egress only for detonation, and cites the hosts", () => {
    const report = {
      derived: { egress_to_unknown_host: true },
      runs: [{ egress: [{ host: "203.0.113.10", port: 443 }] }],
    };
    expect(hardRuleFindings([check("smoke", report)])).toEqual([]);
    const [f] = hardRuleFindings([check("detonation", report)]);
    expect(f).toMatchObject({ severity: "critical", evidence: "egress: 203.0.113.10" });
    // With sniff.py's `known` flag, only the hosts that failed the check are cited.
    const mixed = {
      derived: { egress_to_unknown_host: true },
      egress: [
        { host: "pypi.org", port: 443, known: true },
        { host: "203.0.113.10", port: 443, known: false },
      ],
    };
    expect(hardRuleFindings([check("detonation", mixed)])[0]?.evidence).toBe(
      "egress: 203.0.113.10",
    );
  });

  it("emits one finding per rule per check", () => {
    const found = hardRuleFindings([
      check("tests", { base_pass_head_fail: ["t"], secret_probe: { decoy_read: true } }),
      check("detonation", {
        secret_probe: { decoy_read: true },
        derived: { wrote_sensitive: true, egress_to_unknown_host: true },
      }),
    ]);
    expect(found).toHaveLength(5);
    expect(found.every((f) => f.severity === "critical")).toBe(true);
  });
});

describe("missingCheckFindings", () => {
  it("warns once per required check without a report, ignoring non-check threads", () => {
    const found = missingCheckFindings([
      check("tests", { base_pass_head_fail: [] }),
      check("probes", {}, false),
      // A thread that never produced a report counts as missing too.
      check("smoke", null),
    ]);
    expect(found.map((f) => [f.severity, f.check, f.source])).toEqual([
      ["warn", "probes", "hard_rule"],
      ["warn", "smoke", "hard_rule"],
    ]);
    expect(
      missingCheckFindings([check("tests", {}), check("probes", {}), check("smoke", {})]),
    ).toEqual([]);
  });
});

describe("agentFindings", () => {
  const review = (findings: unknown[]): DraftedReview => ({
    tool: "post_advisory_review",
    toolCallId: "c",
    body: "",
    comments: [],
    findings,
  });

  it("keeps well-formed findings with their anchors and drops the rest", () => {
    const out = agentFindings(
      review([
        {
          check: "probes",
          severity: "warn",
          title: "t",
          evidence: "e",
          path: "a.py",
          line: 3,
          side: "LEFT",
        },
        { severity: "info", title: "no check" },
        { check: "x", severity: "fatal", title: "bad severity" },
        { check: "x", severity: "info" },
        "prose",
      ]),
    );
    expect(out).toEqual([
      {
        source: "agent",
        check: "probes",
        severity: "warn",
        title: "t",
        evidence: "e",
        path: "a.py",
        line: 3,
        side: "LEFT",
      },
      { source: "agent", check: "review", severity: "info", title: "no check", evidence: "" },
    ]);
    expect(agentFindings(null)).toEqual([]);
  });
});

describe("mergeFindings", () => {
  const f = (source: Finding["source"], severity: Finding["severity"], title: string): Finding => ({
    source,
    check: "tests",
    severity,
    title,
    evidence: "",
  });

  it("puts hard-rule findings first, drops agent duplicates, and sorts by severity", () => {
    const hard = [f("hard_rule", "critical", "Broke a test")];
    const agent = [
      f("agent", "info", "what ran"),
      f("agent", "warn", "broke a test"),
      f("agent", "critical", "probe disagrees"),
      f("agent", "warn", "no coverage"),
    ];
    expect(mergeFindings(hard, agent).map((x) => [x.source, x.severity, x.title])).toEqual([
      ["hard_rule", "critical", "Broke a test"],
      ["agent", "critical", "probe disagrees"],
      ["agent", "warn", "no coverage"],
      ["agent", "info", "what ran"],
    ]);
  });
});
