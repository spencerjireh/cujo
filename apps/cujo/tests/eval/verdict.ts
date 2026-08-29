/**
 * What a recorded event stream folds to, in the shape a corpus case records.
 *
 * Its own module so that `corpus.test.ts` never imports `capture.ts`: that file
 * is a command-line tool and runs on import, which would print a usage line
 * into every test run and set a non-zero exit code out of nowhere.
 *
 * Deliberately coarse. A case pins the verdict — the status, which hard rules
 * fired, how many findings of each severity — and not the prose of any of them.
 * Wording changes constantly and says nothing about whether the review was
 * right; these three do.
 */

import { fold } from "../../src/review/fold";
import type { Event } from "../../src/review/fold";
import type { HardRule, RunStatus, Severity } from "../../src/review/types";

export interface Verdict {
  status: RunStatus;
  hardRules: HardRule[];
  severity: Record<Severity, number>;
}

export function verdictOf(events: readonly Event[]): Verdict {
  const p = fold(events);
  const severity: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  for (const finding of p.findings) severity[finding.severity] += 1;
  const rules = p.hardRuleHits
    .map((f) => f.rule)
    .filter((rule): rule is HardRule => rule !== undefined);
  return { status: p.status, hardRules: [...new Set(rules)].sort(), severity };
}
