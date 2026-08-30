import { describe, expect, it } from "vitest";
import {
  agentFindings,
  commentsFromFindings,
  hardRuleFindings,
  invalidReportFindings,
  isMaliceClaim,
  isOperationalRule,
  mergeFindings,
  missingCheckFindings,
} from "../../src/review/findings";
import type { CheckState, DraftedReview, Finding } from "../../src/review/types";

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

describe("invalidReportFindings", () => {
  const valid = {
    check: "tests",
    runs: [],
    derived: {
      egress_to_unknown_host: false,
      wrote_outside_workspace: false,
      wrote_sensitive: false,
      spawned_subprocess: false,
    },
  };

  it("says nothing about a report that is the shape of a report", () => {
    expect(invalidReportFindings([check("tests", valid)])).toEqual([]);
  });

  it("says nothing about a report that never arrived, or a thread that is not a check", () => {
    // A null report is `check_missing`; saying both would be saying it twice.
    expect(invalidReportFindings([check("tests", null)])).toEqual([]);
    expect(invalidReportFindings([check("helper", { nonsense: true }, false)])).toEqual([]);
  });

  it("warns, names the field, and never accuses", () => {
    const { derived: _derived, ...noDerived } = valid;
    const [f] = invalidReportFindings([check("tests", noDerived)]);
    expect(f).toMatchObject({
      source: "hard_rule",
      check: "tests",
      severity: "warn",
      rule: "report_invalid",
    });
    expect(f?.evidence).toContain("derived");
    expect(isMaliceClaim(f as Finding)).toBe(false);
  });

  it("adds nothing to a report that carries the envelope and one rule's field", () => {
    // The shape `tests/contract/trueforge.contract.test.ts` sends through a
    // live sub-agent, asserted here because that suite is excluded from
    // `pnpm test` — it needs a running TrueForge — so nothing else in CI would
    // catch this fixture drifting out of the schema.
    const report = {
      check: "tests",
      base_pass_head_fail: ["t_x"],
      runs: [],
      derived: {
        egress_to_unknown_host: false,
        wrote_outside_workspace: false,
        wrote_sensitive: false,
        spawned_subprocess: false,
      },
    };
    expect(invalidReportFindings([check("tests", report)])).toEqual([]);
    expect(hardRuleFindings([check("tests", report)]).map((f) => f.rule)).toEqual(["tests_failed"]);
  });

  it("leaves the rules that read the same report alone", () => {
    // The property the split exists for: a report that fails validation still
    // trips every rule its contents set off. Anything else would let a
    // misplaced roll-up bury a decoy read.
    const broken = { check: "tests", runs: "not an array", secret_probe: { decoy_read: true } };
    expect(invalidReportFindings([check("tests", broken)])).toHaveLength(1);
    expect(hardRuleFindings([check("tests", broken)]).map((f) => f.rule)).toContain("decoy_read");
  });
});

describe("missingCheckFindings says why, not only that", () => {
  const noReport = (over: Partial<CheckState>): CheckState => ({
    ...check("tests", null),
    status: "done",
    ...over,
  });

  it("blames the output limit when the message was cut off", () => {
    const [f] = missingCheckFindings([noReport({ finishReason: "length" })]);
    expect(f?.rule).toBe("check_missing");
    expect(f?.evidence).toContain("output limit");
    expect(f?.evidence).toContain("cut off rather than never written");
  });

  it("says so when the model refused", () => {
    const [f] = missingCheckFindings([noReport({ refused: true })]);
    expect(f?.evidence).toContain("refusal");
  });

  it("falls back to the thread's own state when neither applies", () => {
    const [f] = missingCheckFindings([noReport({ status: "error" })]);
    expect(f?.evidence).toContain("ended error");
  });

  it("keeps the old wording when no thread was ever created", () => {
    const [f] = missingCheckFindings([]);
    expect(f?.evidence).toContain("no sub-agent thread named for it");
  });
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

describe("isMaliceClaim", () => {
  const of = (checks: CheckState[]) => hardRuleFindings(checks).map(isMaliceClaim);

  it("separates the accusation from the report of a broken test", () => {
    // The split is the claim, not whose code it is: three of the four malice
    // rules fire on any check, `tests` included.
    expect(of([check("tests", { base_pass_head_fail: ["t_x"] })])).toEqual([false]);
    expect(of([check("tests", { secret_probe: { decoy_read: true } })])).toEqual([true]);
    expect(of([check("smoke", { derived: { wrote_sensitive: true } })])).toEqual([true]);
    expect(of([check("detonation", { derived: { egress_to_unknown_host: true } })])).toEqual([
      true,
    ]);
  });

  it("says no for a missing check and for anything the agent claimed", () => {
    // A check that never reported is Cujo's own bookkeeping, and an agent
    // finding is not evidence the trusted side derived (decision 21).
    expect(missingCheckFindings([]).every(isMaliceClaim)).toBe(false);
    const agent: Finding = {
      source: "agent",
      check: "detonation",
      severity: "critical",
      title: "this package is malware",
      evidence: "it looks wrong",
    };
    expect(isMaliceClaim(agent)).toBe(false);
  });

  it("says no when the finding predates the rule field", () => {
    // A projection stored before `rule` existed rehydrates without it, and the
    // safe answer is "not an accusation": the tripwire it feeds ends a run in
    // error, and a replayed old run must not start failing.
    const { rule, ...legacy } = hardRuleFindings([
      check("detonation", { derived: { egress_to_unknown_host: true } }),
    ])[0] as Finding;
    expect(rule).toBe("egress_to_unknown_host");
    expect(isMaliceClaim(legacy as Finding)).toBe(false);
  });
});

describe("isOperationalRule", () => {
  it("is true for check_missing and sensor_unarmed", () => {
    expect(missingCheckFindings([]).every(isOperationalRule)).toBe(true);
    const unarmed = hardRuleFindings([
      check("tests", {
        sensors: { proxy: { armed: false, detail: "not started" }, decoy: { armed: true } },
      }),
    ]);
    expect(unarmed.every(isOperationalRule)).toBe(true);
  });

  it("is false for correctness and malice rules", () => {
    const correctness = hardRuleFindings([check("tests", { base_pass_head_fail: ["t_x"] })]);
    expect(correctness.every(isOperationalRule)).toBe(false);
    const malice = hardRuleFindings([check("tests", { secret_probe: { decoy_read: true } })]);
    expect(malice.every(isOperationalRule)).toBe(false);
  });
});

describe("the sensor health block", () => {
  const sensors = (over: Record<string, unknown> = {}) => ({
    sensors: {
      proxy: { armed: true, detail: "port 8899" },
      decoy: { armed: true, detail: "inotify" },
      audit: { armed: true, detail: "12 rows" },
      fs_diff: { armed: true, detail: "900 paths" },
      ...over,
    },
  });

  it("warns once per daemon that was not watching, naming what the sandbox said", () => {
    const found = hardRuleFindings([
      check(
        "probes",
        sensors({ proxy: { armed: false, detail: "started during setup, no longer running" } }),
      ),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "hard_rule",
      check: "probes",
      severity: "warn",
      rule: "sensor_unarmed",
      title: "the proxy sensor was not watching during probes",
    });
    expect(found[0]?.evidence).toContain("no longer running");
  });

  it("says nothing about the two sensors whose being off is not a fault", () => {
    // A check running `npm test` has no Python process to hook, and the
    // filesystem sensor is never off, only incomplete — which `truncated`
    // covers. Warning on either would fire on every JavaScript repository.
    expect(
      hardRuleFindings([
        check(
          "tests",
          sensors({
            audit: { armed: false, detail: "no Python process ran" },
            fs_diff: { armed: false, detail: "walked no files" },
          }),
        ),
      ]),
    ).toEqual([]);
  });

  it("treats an absent block as unknown rather than unarmed", () => {
    // Every report stored before this block existed, and every report an agent
    // writes by hand. Absent is not evidence the sensors were off.
    expect(hardRuleFindings([check("tests", { derived: {} })])).toEqual([]);
    expect(hardRuleFindings([check("tests", { sensors: {} })])).toEqual([]);
    expect(hardRuleFindings([check("tests", { sensors: { proxy: {} } })])).toEqual([]);
    expect(hardRuleFindings([check("tests", { sensors: "broken" })])).toEqual([]);
  });

  it("warns once for a sensor that was down in one run of several", () => {
    // Detonation is several sensed commands. One blind stretch is one warn,
    // not one per run, and the detail comes from the run that lost it.
    const found = hardRuleFindings([
      check("detonation", {
        ...sensors(),
        runs: [sensors(), sensors({ decoy: { armed: false, detail: "atime, no longer running" } })],
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.evidence).toContain("atime, no longer running");
  });

  it("does not gate the run, so a blind sensor cannot look like an accusation", () => {
    const found = hardRuleFindings([
      check("tests", sensors({ decoy: { armed: false, detail: "no watcher armed during setup" } })),
    ]);
    expect(found.map(isMaliceClaim)).toEqual([false]);
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

describe("commentsFromFindings", () => {
  const anchored = (over: Record<string, unknown> = {}) => ({
    check: "probes",
    severity: "warn",
    title: "no test covers this",
    evidence: "",
    path: "app/orders.py",
    line: 42,
    ...over,
  });

  it("makes a comment out of every anchored finding, and only those", () => {
    const out = commentsFromFindings([
      anchored(),
      anchored({ title: "no anchor", path: undefined, line: undefined }),
      anchored({ title: "no line", line: undefined }),
      anchored({ title: "junk line", line: 0 }),
      anchored({ title: "not a line", line: 1.5 }),
      "not an object",
      null,
    ]);
    expect(out.map((c) => [c.path, c.line, c.side])).toEqual([["app/orders.py", 42, "RIGHT"]]);
  });

  it("drops a finding with no title or an invented severity, like agentFindings does", () => {
    const out = commentsFromFindings([
      anchored({ title: "   " }),
      anchored({ title: "urgent", severity: "urgent" }),
    ]);
    expect(out).toEqual([]);
  });

  it("carries LEFT through for a finding about removed code", () => {
    expect(commentsFromFindings([anchored({ side: "LEFT" })])[0]?.side).toBe("LEFT");
  });

  it("orders them by severity, so the board reads like the review", () => {
    const out = commentsFromFindings([
      anchored({ severity: "info", title: "i", line: 1 }),
      anchored({ severity: "critical", title: "c", line: 2 }),
      anchored({ severity: "warn", title: "w", line: 3 }),
    ]);
    expect(out.map((c) => c.line)).toEqual([2, 3, 1]);
  });

  it("posts one comment for a finding sent twice", () => {
    expect(commentsFromFindings([anchored(), anchored()])).toHaveLength(1);
  });

  /**
   * The template is pinned on both sides of the system. `github-mcp` composes
   * the comment it actually posts, and this composes the copy the board shows;
   * the same literal is asserted in `apps/github-mcp/tests/render.test.ts`
   * (decision 74). If the two drift, one finding gets two descriptions.
   */
  it("leads with the severity, because an inline comment has no headline above it", () => {
    const out = commentsFromFindings([
      anchored({
        severity: "critical",
        title: "1 test passes on base and fails on head",
        evidence: "AssertionError: 10.05 != 10.04",
        detail: "The change rounds before the discount rather than after.",
        next: "round after the discount is applied",
      }),
    ]);
    expect(out[0]?.body).toBe(
      "**critical \u2014 1 test passes on base and fails on head**\n\n" +
        "> AssertionError: 10.05 != 10.04\n\n" +
        "The change rounds before the discount rather than after.\n\n" +
        "Next: round after the discount is applied",
    );
  });

  it("drops the parts a finding does not have", () => {
    expect(commentsFromFindings([anchored({ title: "no test covers this" })])[0]?.body).toBe(
      "**warn \u2014 no test covers this**",
    );
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
