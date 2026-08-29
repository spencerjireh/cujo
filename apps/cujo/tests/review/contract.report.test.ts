/**
 * The trusted side against the canonical example in `docs/contracts/`.
 *
 * `check.report` is `unknown` here and in apps/web, so nothing about the report
 * shape is checked by the compiler: a field renamed in `sandbox/` produces no
 * error on this side, only rules that quietly stop firing. The example file is
 * what stands in for the schema. `sandbox/tests/test_contract.py` asserts the
 * producer emits it; this asserts the hard rules can still read it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hardRuleFindings, isMaliceClaim } from "../../src/review/findings";
import { validateReport } from "../../src/review/report-schema";
import type { CheckState, HardRule } from "../../src/review/types";

const EXAMPLE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../docs/contracts/report.example.json"), "utf8"),
);

const check = (title: string, report: unknown): CheckState => ({
  threadId: `th-${title}`,
  title,
  isCheck: true,
  startedAt: null,
  endedAt: null,
  status: "done",
  report,
  error: null,
});

describe("the canonical report example", () => {
  it("trips every rule it was written to trip", () => {
    const rules = hardRuleFindings([check("tests", EXAMPLE)]).map((f) => f.rule);
    expect(rules).toContain<HardRule>("tests_failed");
    expect(rules).toContain<HardRule>("wrote_sensitive");
    expect(rules).toContain<HardRule>("decoy_read");
    expect(rules).toContain<HardRule>("sensor_unarmed");
    // Scoped to detonation: an install talking to an unknown host is the
    // accusation, a test suite doing it is not.
    expect(rules).not.toContain<HardRule>("egress_to_unknown_host");
    expect(hardRuleFindings([check("detonation", EXAMPLE)]).map((f) => f.rule)).toContain<HardRule>(
      "egress_to_unknown_host",
    );
  });

  it("never fires decoy_in_egress, because null is not an observation", () => {
    // The proxy counts bytes and never reads a payload, so the sandbox emits
    // null rather than a false it never measured. `bool()` reads both as "not
    // observed", which is what keeps this safe across a deploy: an old
    // container meeting the new value behaves exactly as it did.
    expect(
      EXAMPLE.runs.every(
        (r: { secret_probe: { decoy_in_egress: unknown } }) =>
          r.secret_probe.decoy_in_egress === null,
      ),
    ).toBe(true);
    expect(hardRuleFindings([check("tests", EXAMPLE)]).map((f) => f.rule)).not.toContain<HardRule>(
      "decoy_in_egress",
    );
  });

  it("names the sensor that was down and does not gate the run on it", () => {
    const unarmed = hardRuleFindings([check("tests", EXAMPLE)]).filter(
      (f) => f.rule === "sensor_unarmed",
    );
    expect(unarmed).toHaveLength(1);
    expect(unarmed[0]).toMatchObject({ severity: "warn", rule: "sensor_unarmed" });
    expect(unarmed[0]?.title).toContain("decoy");
    expect(unarmed[0]?.evidence).toContain("no longer running");
    // A sensor being off says the evidence is thin, not that the code did
    // anything, so it never puts a review through the human gate.
    expect(unarmed.map(isMaliceClaim)).toEqual([false]);
  });

  it("reads the roll-up and the runs as the same shape", () => {
    // findings.ts scans the top level and every runs[] entry; a report that
    // carried a block in only one of the two would be read wrongly in the other.
    for (const block of ["derived", "sensors", "truncated"] as const) {
      expect(Object.keys(EXAMPLE[block]).sort()).toEqual(
        Object.keys(EXAMPLE.runs[0][block]).sort(),
      );
    }
  });

  it("validates against the schema", () => {
    // The example is the contract, so the schema has to accept it or one of the
    // two is wrong. It trips rules, hits caps and carries a sensor that is down,
    // which is what makes it worth validating rather than a clean fixture.
    expect(validateReport(EXAMPLE)).toEqual({ ok: true });
  });

  it("does not carry a detonate entry, so the union's other half is tested apart", () => {
    // Recorded rather than fixed here. Every entry in the example is a
    // `sniff.py run`; a `detonate` entry has neither `argv` nor `exit` and is
    // the other half of the runs[] union. Changing the example reaches
    // sandbox/tests/test_contract.py and apps/web as well, so the coverage sits
    // in report-schema.test.ts and this assertion says why.
    expect(EXAMPLE.runs.every((r: { argv?: unknown }) => r.argv !== undefined)).toBe(true);
  });

  it("still derives the rules when only a run carries the evidence", () => {
    // The sub-agent writes the roll-up, so it can get it wrong. The rules read
    // every layer for exactly that reason.
    const runsOnly = { check: "tests", runs: EXAMPLE.runs };
    const rules = hardRuleFindings([check("tests", runsOnly)]).map((f) => f.rule);
    expect(rules).toContain<HardRule>("wrote_sensitive");
    expect(rules).toContain<HardRule>("decoy_read");
    expect(rules).toContain<HardRule>("sensor_unarmed");
  });
});
