/**
 * What a test run said, read off its output (decision 161).
 *
 * The `tests` sub-agent used to fill `base`, `head` and `base_pass_head_fail`
 * by reading the suite's output; with the executor running the suite, the
 * same reading happens here, with no model. Per-test ids are taken from the
 * lines the common runners print for a failure -- pytest's `FAILED
 * path::test`, vitest's and jest's cross glyph then the name, go's
 * `--- FAIL: Test` -- and the roll-up follows the rubric's own definition: a
 * test that passed on base and failed on head. When neither output names a
 * test, the suite itself is the one id, and its exit code is its result,
 * which is exactly the fact the hard rule needs.
 */

export interface SuiteRun {
  exit: number | null;
  stdout: string;
  stderr: string;
}

export interface SuiteOutcome {
  base: Record<string, "pass" | "fail">;
  head: Record<string, "pass" | "fail">;
  base_pass_head_fail: string[];
  /** Base was never run, because head was clean and could not need it (decision 169). */
  base_not_run?: true;
}

/** The whole suite, when no runner named a test. */
export const SUITE = "suite";

/** The cross glyphs vitest, jest and mocha print before a failed test's name. */
const CROSS = "×✕✗";

const PATTERNS: readonly RegExp[] = [
  // pytest, in `-q` and verbose forms: "FAILED tests/test_x.py::test_y - AssertionError".
  /^FAILED\s+(\S+?)(?:\s+-\s.*)?$/,
  // vitest, jest, mocha: a failure glyph then the name, sometimes a duration after it.
  new RegExp(`^\\s*[${CROSS}]\\s+(.+?)(?:\\s+\\d+\\s*ms)?$`),
  // go test.
  /^\s*--- FAIL:\s+(\S+)/,
];

/** ANSI colour sequences, which some runners print even without a terminal. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The test ids the output names as failed, in order, once each. */
export function failedIds(output: string): string[] {
  const ids: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(ANSI, "").trimEnd();
    for (const pattern of PATTERNS) {
      const match = pattern.exec(line);
      if (match?.[1]) {
        const id = match[1].trim();
        if (!ids.includes(id)) ids.push(id);
        break;
      }
    }
  }
  return ids;
}

export function suiteOutcome(base: SuiteRun, head: SuiteRun): SuiteOutcome {
  const baseFailed = failedIds(`${base.stdout}\n${base.stderr}`);
  const headFailed = failedIds(`${head.stdout}\n${head.stderr}`);
  if (baseFailed.length === 0 && headFailed.length === 0) {
    // Nothing named: the suite is the unit. `null` is a run the service
    // could not finish, which is not a pass.
    const basePass = base.exit === 0;
    const headPass = head.exit === 0;
    return {
      base: { [SUITE]: basePass ? "pass" : "fail" },
      head: { [SUITE]: headPass ? "pass" : "fail" },
      base_pass_head_fail: basePass && !headPass ? [SUITE] : [],
    };
  }
  const baseMap: Record<string, "pass" | "fail"> = {};
  const headMap: Record<string, "pass" | "fail"> = {};
  for (const id of baseFailed) baseMap[id] = "fail";
  for (const id of headFailed) headMap[id] = "fail";
  // A test named as failed on one side and not the other passed there, as far
  // as the output says; a test named on neither side is not in the maps at
  // all, since the runners name only failures.
  for (const id of headFailed) if (!(id in baseMap)) baseMap[id] = "pass";
  for (const id of baseFailed) if (!(id in headMap)) headMap[id] = "pass";
  return {
    base: baseMap,
    head: headMap,
    base_pass_head_fail: headFailed.filter((id) => !baseFailed.includes(id)),
  };
}

/**
 * Whether head answers the only question base could have answered.
 *
 * `base_pass_head_fail` is the tests a run turns on, and it is empty
 * whenever head fails nothing: a test head passed cannot be one head
 * failed, whatever base did. So a clean head makes base's suite evidence
 * about nothing, and the executor does not run it (decision 169).
 */
export function headIsClean(head: SuiteRun): boolean {
  return head.exit === 0 && failedIds(`${head.stdout}\n${head.stderr}`).length === 0;
}

/**
 * The extras of a run whose base was never needed: head's own result, an
 * empty comparison, and the fact that it is empty because nothing was run
 * there. Said rather than left out, because a comparison never made must
 * not read like one that came back clean.
 */
export function headOnlyOutcome(head: SuiteRun): SuiteOutcome {
  const named = failedIds(`${head.stdout}\n${head.stderr}`);
  const headMap: Record<string, "pass" | "fail"> = {};
  for (const id of named) headMap[id] = "fail";
  return {
    base: {},
    head: named.length > 0 ? headMap : { [SUITE]: head.exit === 0 ? "pass" : "fail" },
    base_pass_head_fail: [],
    base_not_run: true,
  };
}
