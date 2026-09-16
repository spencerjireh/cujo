/**
 * The suite's output, read the way the `tests` sub-agent used to read it
 * (decision 161): failed ids per runner, and the regression roll-up.
 */
import { describe, expect, it } from "vitest";
import {
  SUITE,
  failedIds,
  headIsClean,
  headOnlyOutcome,
  suiteOutcome,
} from "../../src/review/suite-outcome";

describe("failedIds", () => {
  it("reads pytest, in quiet and verbose forms", () => {
    const out = [
      "FAILED tests/test_pricing.py::test_rounds_half_up - AssertionError: 2.5",
      "FAILED tests/test_pricing.py::test_other",
      "1 failed, 12 passed in 4.29s",
    ].join("\n");
    expect(failedIds(out)).toEqual([
      "tests/test_pricing.py::test_rounds_half_up",
      "tests/test_pricing.py::test_other",
    ]);
  });

  it("reads vitest and jest crosses, with a duration or without, and go's FAIL lines", () => {
    const esc = String.fromCharCode(27);
    const out = [
      `   ${esc}[31m×${esc}[39m fold > seats an executed check 12ms`,
      "  ✕ renders the footer (34 ms)",
      "  ✓ passes",
      "--- FAIL: TestOrderTotal (0.00s)",
      "    --- FAIL: TestOrderTotal/bulk (0.00s)",
    ].join("\n");
    expect(failedIds(out)).toEqual([
      "fold > seats an executed check",
      "renders the footer (34 ms)",
      "TestOrderTotal",
      "TestOrderTotal/bulk",
    ]);
  });

  it("names each id once", () => {
    expect(failedIds("FAILED a::t\nFAILED a::t\n")).toEqual(["a::t"]);
  });
});

describe("suiteOutcome", () => {
  const ok = (stdout = "") => ({ exit: 0, stdout, stderr: "" });
  const bad = (stdout = "") => ({ exit: 1, stdout, stderr: "" });

  it("is the regression list when head names failures base did not", () => {
    const outcome = suiteOutcome(ok("12 passed"), bad("FAILED t.py::a\nFAILED t.py::b\n"));
    expect(outcome).toEqual({
      base: { "t.py::a": "pass", "t.py::b": "pass" },
      head: { "t.py::a": "fail", "t.py::b": "fail" },
      base_pass_head_fail: ["t.py::a", "t.py::b"],
    });
  });

  it("does not call a test that fails on both trees a regression", () => {
    const outcome = suiteOutcome(
      bad("FAILED t.py::flaky\n"),
      bad("FAILED t.py::flaky\nFAILED t.py::new\n"),
    );
    expect(outcome.base_pass_head_fail).toEqual(["t.py::new"]);
    expect(outcome.base["t.py::flaky"]).toBe("fail");
  });

  it("falls back to the suite's exit when no runner named a test", () => {
    expect(suiteOutcome(ok(), bad())).toEqual({
      base: { [SUITE]: "pass" },
      head: { [SUITE]: "fail" },
      base_pass_head_fail: [SUITE],
    });
    expect(suiteOutcome(ok(), ok()).base_pass_head_fail).toEqual([]);
    expect(suiteOutcome(bad(), bad()).base_pass_head_fail).toEqual([]);
    // A run the service could not finish is not a pass.
    expect(suiteOutcome({ exit: null, stdout: "", stderr: "" }, ok()).base).toEqual({
      [SUITE]: "fail",
    });
  });
});

describe("a head that answers what base was for (decision 169)", () => {
  const ok = (stdout = "") => ({ exit: 0, stdout, stderr: "" });
  const bad = (stdout = "") => ({ exit: 1, stdout, stderr: "" });

  it("is clean only when the suite exited zero and named nothing", () => {
    expect(headIsClean(ok("12 passed"))).toBe(true);
    expect(headIsClean(bad())).toBe(false);
    // A runner that named a failure and still exited zero is not clean: the
    // name is the fact, not the exit code.
    expect(headIsClean(ok("FAILED t.py::a\n"))).toBe(false);
    // Nor is a run the service could not finish.
    expect(headIsClean({ exit: null, stdout: "", stderr: "" })).toBe(false);
  });

  it("reports head alone with an empty comparison that says why it is empty", () => {
    expect(headOnlyOutcome(ok("12 passed"))).toEqual({
      base: {},
      head: { [SUITE]: "pass" },
      base_pass_head_fail: [],
      base_not_run: true,
    });
    // The shape holds for a named failure too, which is what a head that is
    // not clean would carry if it were ever reported this way.
    expect(headOnlyOutcome(bad("FAILED t.py::a\n")).head).toEqual({ "t.py::a": "fail" });
  });
});
