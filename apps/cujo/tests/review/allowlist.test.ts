/**
 * The executor's allowlist rules are the sandbox service's (decision 161):
 * one table of cases, both copies asked, the same answer expected.
 */
import { describe, expect, it } from "vitest";
import { validateAllowlist as theirs } from "../../../sandbox-mcp/src/allowlist";
import { validateAllowlist as ours } from "../../src/review/allowlist";

const CASES: unknown[] = [
  undefined,
  [],
  ["pypi.org", "PyPI.org", " files.pythonhosted.org "],
  ["https://pypi.org"],
  ["pypi.org/simple"],
  ["pypi.org:443"],
  ["*.pypi.org"],
  ["user@pypi.org"],
  ["10.0.0.1"],
  ["localhost"],
  ["a..b"],
  [42],
  "pypi.org",
  Array.from({ length: 33 }, (_, i) => `h${i}.example`),
];

describe("the allowlist copy", () => {
  it("answers every case the way sandbox-mcp does", () => {
    for (const raw of CASES) expect(ours(raw)).toEqual(theirs(raw));
  });
});
