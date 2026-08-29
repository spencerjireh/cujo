/**
 * Findings (docs/spec.md Contract 3) as apps/cujo derives them. Two sources:
 * the hard rules, re-read here from the check reports so the trusted zone
 * enforces them (decision 21), and the agent's own findings carried on the
 * review tool call. A hard-rule finding cannot be lowered or dropped by the
 * agent; an agent finding that duplicates one is discarded.
 */

import { validateReport } from "./report-schema";
import type { CheckState, DraftedReview, Finding, HardRule, Severity } from "./types";

type Obj = Record<string, unknown>;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function bool(value: unknown): boolean {
  return value === true;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Every place a check report can carry a sensor block: the report's own
 * top-level fields, its `derived` and `secret_probe`, and each entry of
 * `runs[]`. The rubric asks for the top-level booleans to be the OR of the
 * runs, but the rules read every layer so a report that skipped that step
 * still trips them.
 */
function sensorLayers(report: unknown): Obj[] {
  const top = obj(report);
  const runs = Array.isArray(top.runs) ? top.runs.map(obj) : [];
  return [top, ...runs];
}

function anyFlag(report: unknown, block: "derived" | "secret_probe", key: string): boolean {
  return sensorLayers(report).some((layer) => bool(obj(layer[block])[key]));
}

/**
 * The hosts that failed the index/allowlist check. sniff.py marks each egress
 * row `known`; a report without the flag cites every host rather than none.
 */
function unknownHosts(report: unknown): string[] {
  const all = new Set<string>();
  const flagged = new Set<string>();
  let hasFlag = false;
  for (const layer of sensorLayers(report)) {
    for (const row of Array.isArray(layer.egress) ? layer.egress : []) {
      const { host, known } = obj(row);
      if (typeof host !== "string") continue;
      all.add(host);
      if (typeof known === "boolean") hasFlag = true;
      if (known === false) flagged.add(host);
    }
  }
  return [...(hasFlag ? flagged : all)];
}

function sensitiveWrites(report: unknown): string[] {
  const paths = new Set<string>();
  for (const layer of sensorLayers(report)) {
    for (const row of Array.isArray(layer.fs_changes) ? layer.fs_changes : []) {
      const change = obj(row);
      if (bool(change.sensitive) && typeof change.path === "string") paths.add(change.path);
    }
  }
  return [...paths];
}

/**
 * The sensors whose being off is worth saying out loud: the two long-running
 * daemons, which `setup` starts and every check depends on for the rest of the
 * run. The other two are reported but not ruled on. `audit` is unarmed for any
 * check that runs no Python at all — every JavaScript repository — and
 * `fs_diff` is never off, only incomplete, which `truncated.snapshot` covers.
 */
const WATCHED_SENSORS = ["proxy", "decoy"] as const;

/**
 * The sensors that were not watching while this check ran, with what the
 * sandbox said about each. Empty for a report from before the block existed:
 * absent is "unknown", and a warn on every historical report would be noise.
 */
function unarmedSensors(report: unknown): { name: string; detail: string }[] {
  const worst = new Map<string, string>();
  for (const layer of sensorLayers(report)) {
    const sensors = obj(layer.sensors);
    for (const name of WATCHED_SENSORS) {
      const entry = obj(sensors[name]);
      if (entry.armed !== false) continue;
      worst.set(name, typeof entry.detail === "string" ? entry.detail : "no detail given");
    }
  }
  return [...worst].map(([name, detail]) => ({ name, detail }));
}

/**
 * Layer 1. One `critical` finding per rule per check that tripped it. Reads
 * the reports leniently: a missing field is "not observed", never a hit.
 */
export function hardRuleFindings(checks: readonly CheckState[]): Finding[] {
  const findings: Finding[] = [];
  for (const check of checks) {
    if (!check.isCheck || check.report === null) continue;
    const name = check.title;
    const report = check.report;
    const top = obj(report);

    // Before the rules, because it changes what the rest of them are worth: a
    // rule that did not fire on a sensor that was not watching has said
    // nothing. `warn`, not `critical` — this accuses the run, not the code.
    for (const sensor of unarmedSensors(report)) {
      findings.push({
        source: "hard_rule",
        check: name,
        severity: "warn",
        rule: "sensor_unarmed",
        title: `the ${sensor.name} sensor was not watching during ${name}`,
        evidence: `sensors.${sensor.name}: ${sensor.detail}; anything it would have seen is absent from this report, not absent from the run`,
      });
    }

    if (name === "tests") {
      const failed = strings(top.base_pass_head_fail);
      if (failed.length > 0) {
        findings.push({
          source: "hard_rule",
          check: name,
          severity: "critical",
          rule: "tests_failed",
          title:
            failed.length === 1
              ? "1 test passes on base and fails on head"
              : `${failed.length} tests pass on base and fail on head`,
          evidence: failed.join(", "),
        });
      }
    }

    if (anyFlag(report, "secret_probe", "decoy_read")) {
      findings.push({
        source: "hard_rule",
        check: name,
        severity: "critical",
        rule: "decoy_read",
        title: `the seeded decoy secret was read during ${name}`,
        evidence: "secret_probe.decoy_read = true",
      });
    }
    if (anyFlag(report, "secret_probe", "decoy_in_egress")) {
      findings.push({
        source: "hard_rule",
        check: name,
        severity: "critical",
        rule: "decoy_in_egress",
        title: `the seeded decoy secret left the sandbox during ${name}`,
        evidence: "secret_probe.decoy_in_egress = true",
      });
    }
    if (anyFlag(report, "derived", "wrote_sensitive")) {
      const paths = sensitiveWrites(report);
      findings.push({
        source: "hard_rule",
        check: name,
        severity: "critical",
        rule: "wrote_sensitive",
        title: `a write landed in a sensitive path during ${name}`,
        evidence: paths.length ? paths.join(", ") : "derived.wrote_sensitive = true",
      });
    }
    if (name === "detonation" && anyFlag(report, "derived", "egress_to_unknown_host")) {
      const hosts = unknownHosts(report);
      findings.push({
        source: "hard_rule",
        check: name,
        severity: "critical",
        rule: "egress_to_unknown_host",
        title: "an install contacted a host that is neither a package index nor allowlisted",
        evidence: hosts.length
          ? `egress: ${hosts.join(", ")}`
          : "derived.egress_to_unknown_host = true",
      });
    }
  }
  return findings;
}

/**
 * The rules that accuse code of acting against the person running it, rather
 * than of being broken. The split is not "the author's code versus a
 * dependency's": three of these fire on *any* check, `tests` and `smoke`
 * included, and only `egress_to_unknown_host` is scoped to `detonation`. It is
 * the claim that differs. "Your tests fail" is mechanical and verifiable in
 * thirty seconds; "this code tried to steal a credential" harms someone if it
 * is wrong, and is the only place in this pipeline where a human holds
 * information the sandbox cannot observe — they know the host, the package, or
 * the fixture that touches a fake credentials file on purpose.
 */
const MALICE_RULES = new Set<HardRule>([
  "decoy_read",
  "decoy_in_egress",
  "wrote_sensitive",
  "egress_to_unknown_host",
]);

/**
 * Does this finding accuse, rather than report? False for an agent finding:
 * only a rule Cujo derived itself is evidence the trusted side can act on
 * (decision 21), and false is the safe answer for a projection stored before
 * `rule` existed.
 */
export function isMaliceClaim(finding: Finding): boolean {
  return finding.rule !== undefined && MALICE_RULES.has(finding.rule);
}

/**
 * One `warn` per check whose report is not the shape a report is.
 *
 * Deliberately its own pass rather than a branch inside `hardRuleFindings`, and
 * the separation is the design, not tidiness. **The validator may only add.**
 * Treating a report that failed validation as no report at all would mean a
 * sub-agent that got one roll-up wrong could turn a `decoy_read: true` sitting
 * in plain sight inside `runs[]` into a `warn` about formatting — a strict loss
 * against reading it leniently, which is what the rules above already do
 * everywhere. Keeping the two passes apart is what makes that impossible to
 * regress: `hardRuleFindings` never learns whether validation passed.
 *
 * A `null` report is skipped. That one is `check_missing`, reported below, and
 * saying both about the same check would be saying the same thing twice.
 */
export function invalidReportFindings(checks: readonly CheckState[]): Finding[] {
  const findings: Finding[] = [];
  for (const check of checks) {
    if (!check.isCheck || check.report === null) continue;
    const result = validateReport(check.report);
    if (result.ok) continue;
    findings.push({
      source: "hard_rule",
      check: check.title,
      severity: "warn",
      rule: "report_invalid",
      title: `the ${check.title} report does not match the report schema`,
      evidence: `${result.problem}; the hard rules still read this report, so what they found is unaffected`,
    });
  }
  return findings;
}

/** The checks every review must delegate; `detonation` depends on the PR. */
export const REQUIRED_CHECKS = ["tests", "probes", "smoke"] as const;

/**
 * One `warn` per required check that never arrived as a sub-agent thread.
 * The rubric forbids the parent from running a check itself; when it does,
 * the hard rules have nothing to read, and the review has to say so.
 */
export function missingCheckFindings(checks: readonly CheckState[]): Finding[] {
  // A thread counts only once it returned a report: one still running or
  // ended in error without one gave the rules nothing either.
  const seen = new Set(checks.filter((c) => c.isCheck && c.report !== null).map((c) => c.title));
  return REQUIRED_CHECKS.filter((name) => !seen.has(name)).map((name) => ({
    source: "hard_rule",
    check: name,
    severity: "warn",
    rule: "check_missing",
    title: `the ${name} check returned no report`,
    evidence:
      "no sub-agent thread named for it ended with a report; the hard rules had nothing to read",
  }));
}

function isSeverity(value: unknown): value is Severity {
  return value === "info" || value === "warn" || value === "critical";
}

/** Layer 2: the findings the agent attached to its review tool call. */
export function agentFindings(review: DraftedReview | null): Finding[] {
  const out: Finding[] = [];
  for (const raw of review?.findings ?? []) {
    const f = obj(raw);
    if (typeof f.title !== "string" || !isSeverity(f.severity)) continue;
    const finding: Finding = {
      source: "agent",
      check: typeof f.check === "string" ? f.check : "review",
      severity: f.severity,
      title: f.title,
      evidence: typeof f.evidence === "string" ? f.evidence : "",
    };
    if (typeof f.path === "string") finding.path = f.path;
    if (typeof f.line === "number") finding.line = f.line;
    if (f.side === "LEFT" || f.side === "RIGHT") finding.side = f.side;
    out.push(finding);
  }
  return out;
}

/**
 * Hard-rule findings first, then the agent's, minus any that repeat a
 * hard-rule finding's check and title; sorted critical > warn > info with a
 * stable order inside a severity.
 */
export function mergeFindings(hard: readonly Finding[], agent: readonly Finding[]): Finding[] {
  const seen = new Set(hard.map((f) => `${f.check} ${f.title.toLowerCase()}`));
  const merged = [...hard];
  for (const f of agent) {
    const key = `${f.check} ${f.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }
  return merged
    .map((f, index) => ({ f, index }))
    .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.index - b.index)
    .map(({ f }) => f);
}
