/**
 * The check report, as a schema (docs/spec.md Contract 2).
 *
 * Until this file existed the report shape was enforced by prose in
 * `agent/SKILL.md` and by nothing at all on this side: `check.report` is
 * `unknown`, and `findings.ts` reads every field through coercion helpers where
 * a missing or renamed key is "not observed", which the hard rules read as "no
 * hit". That is the wrong direction to fail in. A rule that stops firing because
 * a field moved looks exactly like a clean run.
 *
 * So this validates the shape and says so when it does not hold. It does not
 * gate the rules — `hardRuleFindings` still reads whatever arrived, leniently,
 * because a report that is 90% right should still trip the tripwire in the 90%.
 * What this adds is a `warn` saying the evidence is not the shape it claims,
 * which is the honest thing to put in front of a reader.
 *
 * Two rules govern every line below.
 *
 * **Extras pass through.** Decision 54 makes the report additive-only, and the
 * sandbox is always newer than the container reading it. A field this schema has
 * never heard of is a field from a newer `sniff.py`, not an error.
 *
 * **`schema_version` is read, never enforced.** Contract 2: "Read what you
 * recognise; never reject a report for carrying a version you do not know." It
 * has to be present and it has to be a number; its value is not this file's
 * business.
 */

import { z } from "zod";

/**
 * One host the proxy saw.
 *
 * `known` is optional on purpose, and not only for old reports: `merge_egress`
 * carries the verdict through a merge rather than recomputing it, and "a row
 * that never had one stays without one"
 * (`sandbox/cujo_sniff/report.py:163-172`). `findings.ts` already reads the
 * absence correctly — a report with no flag anywhere cites every host rather
 * than none.
 */
const EgressRow = z
  .object({
    host: z.string(),
    port: z.number().optional(),
    bytes: z.number().optional(),
    known: z.boolean().optional(),
  })
  .passthrough();

const FileRead = z
  .object({
    path: z.string(),
    sensitive: z.boolean().optional(),
  })
  .passthrough();

const FsChange = z
  .object({
    path: z.string(),
    type: z.string().optional(),
    in_workspace: z.boolean().optional(),
    sensitive: z.boolean().optional(),
  })
  .passthrough();

/** `exit` is null for a process the audit hook saw but did not wait on. */
const Subprocess = z
  .object({
    argv: z.array(z.string()),
    exit: z.number().nullable().optional(),
  })
  .passthrough();

/**
 * `decoy_in_egress` is `null` on every report the current sandbox writes: the
 * proxy counts bytes and never reads a payload, so nothing in there can tell
 * whether the decoy's value left the box (decisions 20 and 54). Nullable, and
 * deliberately not `z.boolean()` — a schema that demanded a boolean here would
 * reject every real report.
 */
const SecretProbe = z
  .object({
    decoy_read: z.boolean(),
    decoy_in_egress: z.boolean().nullable(),
  })
  .passthrough();

/**
 * One sensor's health.
 *
 * `armed` is required and `detail` is not, and the asymmetry is the point.
 * `armed` is what `unarmedSensors` rules on; `detail` is prose for a human
 * ("port 8899", "793 rows"). Every `runs[]` entry carries both, verbatim from
 * `sniff.py` — but the envelope's `sensors` is a roll-up the sub-agent writes
 * by hand, and asking a model to transcribe four prose strings it has already
 * quoted below adds nothing a reader or a rule can use.
 *
 * Requiring it was a real finding on the first production run after this
 * shipped: every roll-up carried `{"armed": true}` and no `detail`, so the
 * validator warned on a report that was correct in every way that matters. A
 * warn that fires on every review is one nobody reads, which costs more than
 * the check was ever worth.
 */
const SensorHealth = z
  .object({
    armed: z.boolean(),
    detail: z.string().optional(),
  })
  .passthrough();

/**
 * All four are named, and every one of them is optional.
 *
 * `build_sensor_block` always emits the four, but `merge_reports` does not:
 * it `continue`s past a sensor no report in the batch carried
 * (`sandbox/cujo_sniff/report.py:192-199`), so a merged block — which is what a
 * `detonate` entry carries — can be short a key. Requiring them here would
 * reject a report the sandbox considers correct.
 *
 * `findings.ts` rules on two of them (`proxy` and `decoy`) and reports the rest.
 */
const Sensors = z
  .object({
    proxy: SensorHealth.optional(),
    decoy: SensorHealth.optional(),
    audit: SensorHealth.optional(),
    fs_diff: SensorHealth.optional(),
  })
  .passthrough();

const Truncated = z
  .object({
    stdout_tail: z.boolean(),
    stderr_tail: z.boolean(),
    files_read: z.boolean(),
    snapshot: z.boolean(),
    hashes: z.boolean(),
    script_content: z.boolean().optional(),
  })
  .passthrough();

const Derived = z
  .object({
    egress_to_unknown_host: z.boolean(),
    wrote_outside_workspace: z.boolean(),
    wrote_sensitive: z.boolean(),
    spawned_subprocess: z.boolean(),
  })
  .passthrough();

/** The block `build_sensor_block` returns, identical on every kind of run. */
const sensorBlock = {
  egress: z.array(EgressRow),
  files_read: z.array(FileRead),
  fs_changes: z.array(FsChange),
  subprocesses: z.array(Subprocess),
  secret_probe: SecretProbe,
  sensors: Sensors,
  truncated: Truncated,
  derived: Derived,
};

/** What both kinds of entry carry on top of the sensor block. */
const runCommon = {
  schema_version: z.number(),
  duration_s: z.number(),
  window_exclusive: z.boolean(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  ...sensorBlock,
};

/** `sniff.py run`: a wrapped command. */
const CommandRun = z
  .object({
    ...runCommon,
    argv: z.array(z.string()),
    exit: z.number(),
    script_content: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * `sniff.py detonate`: one dependency installed in a fresh environment. It
 * carries neither `argv` nor `exit` — the commands it ran are in
 * `subprocesses[]` instead — which is the whole reason `runs[]` is a union and
 * not one shape with optional halves.
 */
const DependencyRun = z
  .object({
    ...runCommon,
    dependency: z.string(),
    source: z.string(),
    install_ok: z.boolean(),
  })
  .passthrough();

const RunEntry = z.union([CommandRun, DependencyRun]);

/**
 * The envelope a check sub-agent returns.
 *
 * Three required fields, and the line between them and the rest is drawn at
 * exactly what the rubric asks for today. A session pins its rubric at creation
 * (decision 16), so every pull request open when this ships keeps the wording it
 * was created with — and requiring a field that wording never named would put a
 * `report_invalid` warn on every in-flight review for nothing. The rubric names
 * `check`, `runs[]` and `derived`, so those three are required.
 *
 * `schema_version`, `sensors` and `truncated` at this level are optional for
 * that reason alone, not because they do not matter — the envelope in
 * `docs/contracts/report.example.json` carries all three, and the rubric edit
 * that ships with this file asks for them, so a session created from here on
 * will send them. Typed when present, absent without complaint when not.
 *
 * They cost the review nothing when absent in any case: the hard rules read the
 * top level *and* each `runs[]` entry precisely so a roll-up nobody wrote cannot
 * hide a signal.
 *
 * The per-check extras (`base`, `head`, `base_pass_head_fail`, `probes`,
 * `endpoints`, `log_tail`) are not required either. A missing
 * `base_pass_head_fail` means no failing tests were reported, which is a claim
 * `hardRuleFindings` already handles.
 *
 * `check` is a string and not the four-name enum. A report is attributed to a
 * check by its sub-agent thread title, never by this field, so disagreeing with
 * the thread is worth nothing and rejecting it would only lose the rest.
 */
const Report = z
  .object({
    schema_version: z.number().optional(),
    check: z.string(),
    runs: z.array(RunEntry),
    derived: Derived,
    sensors: Sensors.optional(),
    truncated: Truncated.optional(),
  })
  .passthrough();

export type ReportProblem = { ok: true } | { ok: false; problem: string };

/** Long enough to name a nested path and its reason, short enough for a card. */
const PROBLEM_MAX = 200;

/**
 * The first thing wrong with this report, in a phrase, or `ok`.
 *
 * One issue and not all of them: this string ends up in a finding's `evidence`
 * on a public page and in a Discord card, and a wall of zod paths tells a reader
 * less than the first concrete thing that did not match. Zod orders issues by
 * path, so the first is also the outermost, which is the one worth naming.
 *
 * **The path is quoted; the value never is.** Every string in a report is
 * written by the code under review (Contract 2), and the sandbox escapes those
 * on the way out. A zod message that echoed a received value would be a second
 * route for that text into a review body and a browser, one that did not pass
 * through the escaping — so the message is capped and the value stays out of it.
 * `z.union` also reports both branches at once, which is unreadable; taking one
 * issue is what keeps that legible.
 *
 * A `null` report — the sub-agent's message held no JSON at all — is not this
 * function's business. That is `check_missing`, reported separately.
 */
export function validateReport(report: unknown): ReportProblem {
  const result = Report.safeParse(report);
  if (result.success) return { ok: true };
  const issue = result.error.issues[0];
  if (!issue) return { ok: false, problem: "did not match the report schema" };
  const path = issue.path.join(".");
  const problem = path ? `${path}: ${issue.message}` : issue.message;
  return { ok: false, problem: problem.slice(0, PROBLEM_MAX) };
}
