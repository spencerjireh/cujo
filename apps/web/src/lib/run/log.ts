/**
 * The run page as an evidence log (decision 154): what happened, in the order
 * it happened, each entry beside the evidence for it. Pure: a `Run` in, a
 * list of entries out, so the shape of the page is a unit test and the
 * component only draws.
 *
 * Time is measured from the turn's start, so an entry reads `+2m 49s` the way
 * the timeline's lanes do. A run recorded before `setup` existed measures
 * from its first check instead, and a run with neither has no clock.
 */

import { type Alarm, type SensorBlock, alarms, parseReport } from "@/lib/api/report";
import {
  CHECK_NAMES,
  type CheckState,
  type Finding,
  type LedgerThread,
  type Run,
  type Severity,
} from "@/lib/api/types";
import { SEVERITY_ORDER } from "@/lib/board/tone";

/** One wrapped command a check ran, as the sensor saw it. */
interface LogCommand {
  argv: string[];
  exit: number | null;
  durationS: number | null;
  /** The probe or detonation this command belongs to, when the report names one. */
  label: string | null;
}

export interface CheckEntry {
  kind: "check";
  name: string;
  /** Milliseconds after the clock's zero, or null when the run has no clock. */
  at: number | null;
  status: CheckState["status"];
  error: string | null;
  wallMs: number | null;
  sandboxMs: number | null;
  /** Summed over every attempt at this check's name, from the ledger. */
  tokens: { input: number; output: number; cacheRead: number } | null;
  attempts: number;
  commands: LogCommand[];
  /** What tripped, worst first and deduplicated across the report's blocks. */
  alarms: Alarm[];
  /** This check's findings, worst first; `info` is folded by the page. */
  findings: Finding[];
  /**
   * How many hosts the sandbox reached. Null when the report says nothing,
   * and null when an unknown host was among them, since that is an alarm
   * above and the count would say it twice.
   */
  egressHosts: number | null;
  /** The parsed report, for the evidence tables and the raw view. */
  blocks: SensorBlock[];
  raw: unknown;
  /** The check reported nothing at all. */
  empty: boolean;
}

interface SetupEntry {
  kind: "setup";
  at: number | null;
  ms: number | null;
  messages: number;
  sandboxProvisionedMs: number | null;
}

export interface ReviewEntry {
  kind: "review";
  posted: boolean;
  blocking: boolean;
  /** The model's one-sentence lede. */
  lede: string;
  anchored: number;
  /** Findings no check produced: the reading itself, in diff mode. */
  findings: Finding[];
}

interface EndEntry {
  kind: "end";
  status: Run["status"];
  error: string | null;
}

export type LogEntry = SetupEntry | CheckEntry | ReviewEntry | EndEntry;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The clock's zero: the turn's creation, else the earliest check start. */
export function clockZero(run: Run): number | null {
  const turn = ms(run.setup?.turnCreatedAt);
  if (turn !== null) return turn;
  const starts = run.checks
    .map((check) => ms(check.startedAt))
    .filter((t): t is number => t !== null);
  return starts.length ? Math.min(...starts) : null;
}

/** Tokens per check name, every attempt summed. Null when the ledger is absent. */
function tokensByCheck(
  threads: LedgerThread[] | undefined,
): Map<string, CheckEntry["tokens"]> | null {
  if (!threads) return null;
  const out = new Map<string, { input: number; output: number; cacheRead: number }>();
  for (const thread of threads) {
    const bucket = out.get(thread.title) ?? { input: 0, output: 0, cacheRead: 0 };
    bucket.input += thread.inputTokens;
    bucket.output += thread.outputTokens;
    bucket.cacheRead += thread.cacheReadTokens;
    out.set(thread.title, bucket);
  }
  return out;
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

function dedupeAlarms(blocks: SensorBlock[], check: string): Alarm[] {
  const seen = new Map<string, Alarm>();
  for (const block of blocks) {
    for (const alarm of alarms(block, check)) {
      const held = seen.get(alarm.text);
      if (!held || RANK[alarm.severity] < RANK[held.severity]) seen.set(alarm.text, alarm);
    }
  }
  return [...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

function commandsOf(blocks: SensorBlock[]): LogCommand[] {
  return blocks.flatMap((block) =>
    block.command
      ? [
          {
            argv: block.command.argv,
            exit: block.command.exit,
            durationS: block.command.duration_s,
            label: block.label,
          },
        ]
      : [],
  );
}

function egressHostsOf(blocks: SensorBlock[]): number | null {
  if (blocks.length === 0) return null;
  if (blocks.some((block) => block.derived?.egress_to_unknown_host)) return null;
  const hosts = new Set<string>();
  for (const block of blocks) for (const entry of block.egress) hosts.add(entry.host);
  return hosts.size;
}

/**
 * The last thread for each check name wins the report, the way the digest
 * reads it (decision 108): an earlier attempt that died holds the fault its
 * retry fixed. Attempts are counted so the entry can say it was retried.
 */
function latestByName(checks: CheckState[]): { check: CheckState; attempts: number }[] {
  const byName = new Map<string, { check: CheckState; attempts: number }>();
  for (const check of checks) {
    if (!check.isCheck) continue;
    const held = byName.get(check.title);
    byName.set(check.title, { check, attempts: (held?.attempts ?? 0) + 1 });
  }
  return [...byName.values()];
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

export function buildLog(run: Run): LogEntry[] {
  const zero = clockZero(run);
  const offset = (iso: string | null | undefined): number | null => {
    const t = ms(iso);
    return zero === null || t === null ? null : Math.max(0, t - zero);
  };
  const tokens = tokensByCheck(run.ledger?.threads);
  const entries: LogEntry[] = [];

  if (run.setup && run.mode !== "diff") {
    entries.push({
      kind: "setup",
      at: zero === null ? null : 0,
      ms: run.setup.ms ?? null,
      messages: run.setup.messages,
      sandboxProvisionedMs: run.setup.sandboxProvisionedMs ?? null,
    });
  }

  const checks = latestByName(run.checks)
    .map(({ check, attempts }) => {
      const parsed = parseReport(check.report);
      const blocks = parsed.kind === "sensor" ? parsed.blocks : [];
      const entry: CheckEntry = {
        kind: "check",
        name: check.title,
        at: offset(check.startedAt),
        status: check.status,
        error: check.error,
        wallMs: check.timings?.wallMs ?? null,
        sandboxMs: check.timings?.sandboxMs ?? null,
        tokens: tokens ? (tokens.get(check.title) ?? null) : null,
        attempts,
        commands: commandsOf(blocks),
        alarms: dedupeAlarms(blocks, check.title),
        findings: sortFindings(run.findings.filter((f) => f.check === check.title)),
        egressHosts: egressHostsOf(blocks),
        blocks,
        raw: parsed.kind === "empty" ? null : parsed.raw,
        empty: parsed.kind === "empty",
      };
      return entry;
    })
    // In the order they started; a check with no clock keeps the four's fixed order.
    .sort((a, b) => {
      if (a.at !== null && b.at !== null && a.at !== b.at) return a.at - b.at;
      return CHECK_NAMES.indexOf(a.name as never) - CHECK_NAMES.indexOf(b.name as never);
    });
  entries.push(...checks);

  const checkNames = new Set(checks.map((c) => c.name));
  const unowned = sortFindings(run.findings.filter((f) => !checkNames.has(f.check)));
  if (run.review) {
    entries.push({
      kind: "review",
      posted: run.status !== "running",
      blocking: run.review.tool !== "post_advisory_review",
      // One sentence since decision 74; a body from before it is cut to its
      // first line here, since the whole of it folds below as posted.
      lede: run.review.body.split("\n")[0]?.trim() ?? "",
      anchored: run.review.comments.length,
      findings: unowned,
    });
  } else if (unowned.length) {
    // Findings with no check and no review: a run that ended without posting.
    entries.push({
      kind: "review",
      posted: false,
      blocking: false,
      lede: "",
      anchored: 0,
      findings: unowned,
    });
  }

  if (run.status !== "running") entries.push({ kind: "end", status: run.status, error: run.error });
  return entries;
}

/** `+2m 49s`, or null when the run has no clock. */
export function offsetLabel(at: number | null): string | null {
  if (at === null) return null;
  const total = Math.round(at / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `+${m}m ${s}s` : `+${s}s`;
}
