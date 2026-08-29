/**
 * The eval corpus: recorded runs, replayed through `fold`, against the verdict
 * a person decided they should produce.
 *
 * This is the only test in the repository that exercises what an agent actually
 * emitted rather than what somebody imagined it would. `agent/SKILL.md` has
 * more leverage over a verdict than any file in `src/`, and until this existed
 * it was the one file with no test — a rubric edit could not be checked at all
 * until a new pull request reached production, because a session pins its
 * rubric at creation (decision 16).
 *
 * **`expected` is edited by hand, never regenerated.** There is deliberately no
 * `--update` and no `toMatchSnapshot`: a verdict a tool refreshes is a verdict
 * nobody chose, and the point of the corpus is that changing one shows up as a
 * reviewable diff. When a case fails, read it, decide whether the new verdict
 * is better, and edit the block. `capture.ts --verdict` prints the current one
 * to paste.
 *
 * The file name matters: `apps/cujo/vitest.config.ts` excludes
 * `**\/*.contract.test.ts`, because those need a live TrueForge server. Naming
 * this `eval.contract.test.ts` would have CI skip it in silence.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "../../src/review/fold";
import { type Verdict, verdictOf } from "./verdict";

const CASES = join(import.meta.dirname, "cases");

interface Case {
  session_id: string;
  expected: Verdict;
  events: Event[];
}

const files = readdirSync(CASES).filter((name) => name.endsWith(".json"));

describe("the eval corpus", () => {
  it("has cases in it", () => {
    // The assertion that stops the rest of this file from passing vacuously,
    // which is how a corpus quietly becomes decoration.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s folds to the verdict somebody chose", (name) => {
    const c = JSON.parse(readFileSync(join(CASES, name), "utf8")) as Case;
    // Read as data rather than imported: `resolveJsonModule` is on and `tests`
    // is in the TS program, so an import would drag every fixture through tsc.
    expect(c.events.length).toBeGreaterThan(0);
    expect(c.expected).toBeDefined();
    expect(verdictOf(c.events)).toEqual(c.expected);
  });
});
