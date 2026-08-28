/**
 * `check.report` is `unknown`: apps/cujo parses the first fenced JSON block out
 * of a subagent's message and stores whatever comes back, so it may be null, a
 * bare sensor block, a `{runs:[...]}` wrapper, or something no contract
 * describes. Nothing here throws; anything unrecognised falls through to the
 * raw view.
 */

export interface EgressEntry {
  host: string;
  port?: number;
  bytes?: number;
  known?: boolean;
}

export interface FileReadEntry {
  path: string;
  sensitive?: boolean;
}

export interface FsChangeEntry {
  path: string;
  type?: string;
  in_workspace?: boolean;
  sensitive?: boolean;
}

export interface SubprocessEntry {
  argv: string[];
  exit?: number;
}

export interface SecretProbe {
  decoy_read?: boolean;
  decoy_in_egress?: boolean;
}

export interface Derived {
  egress_to_unknown_host?: boolean;
  wrote_outside_workspace?: boolean;
  wrote_sensitive?: boolean;
  spawned_subprocess?: boolean;
}

/** One sensor block, plus whatever identifying fields sat beside it. */
export interface SensorBlock {
  label: string | null;
  egress: EgressEntry[];
  files_read: FileReadEntry[];
  fs_changes: FsChangeEntry[];
  subprocesses: SubprocessEntry[];
  secret_probe: SecretProbe | null;
  derived: Derived | null;
}

export type ParsedReport =
  | { kind: "empty" }
  | { kind: "sensor"; blocks: SensorBlock[]; raw: unknown }
  | { kind: "opaque"; raw: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function egress(value: unknown): EgressEntry[] {
  return asArray(value).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const host = str(entry.host);
    if (!host) return [];
    return [{ host, port: num(entry.port), bytes: num(entry.bytes), known: bool(entry.known) }];
  });
}

function filesRead(value: unknown): FileReadEntry[] {
  return asArray(value).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const path = str(entry.path);
    return path ? [{ path, sensitive: bool(entry.sensitive) }] : [];
  });
}

function fsChanges(value: unknown): FsChangeEntry[] {
  return asArray(value).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const path = str(entry.path);
    if (!path) return [];
    return [
      {
        path,
        type: str(entry.type) ?? undefined,
        in_workspace: bool(entry.in_workspace),
        sensitive: bool(entry.sensitive),
      },
    ];
  });
}

function subprocesses(value: unknown): SubprocessEntry[] {
  return asArray(value).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const argv = asArray(entry.argv).filter((a): a is string => typeof a === "string");
    return argv.length > 0 ? [{ argv, exit: num(entry.exit) }] : [];
  });
}

function secretProbe(value: unknown): SecretProbe | null {
  if (!isRecord(value)) return null;
  return { decoy_read: bool(value.decoy_read), decoy_in_egress: bool(value.decoy_in_egress) };
}

function derived(value: unknown): Derived | null {
  if (!isRecord(value)) return null;
  return {
    egress_to_unknown_host: bool(value.egress_to_unknown_host),
    wrote_outside_workspace: bool(value.wrote_outside_workspace),
    wrote_sensitive: bool(value.wrote_sensitive),
    spawned_subprocess: bool(value.spawned_subprocess),
  };
}

const SENSOR_KEYS = [
  "egress",
  "files_read",
  "fs_changes",
  "subprocesses",
  "secret_probe",
  "derived",
] as const;

function looksLikeSensorBlock(value: unknown): boolean {
  return isRecord(value) && SENSOR_KEYS.some((key) => key in value);
}

function toBlock(value: Record<string, unknown>): SensorBlock {
  return {
    label: str(value.dependency) ?? str(value.name) ?? str(value.label),
    egress: egress(value.egress),
    files_read: filesRead(value.files_read),
    fs_changes: fsChanges(value.fs_changes),
    subprocesses: subprocesses(value.subprocesses),
    secret_probe: secretProbe(value.secret_probe),
    derived: derived(value.derived),
  };
}

/**
 * Sensor data appears at the top level, and `findings.ts` also reads it inside
 * each entry of a `runs[]` array, so a detonation report may carry several
 * blocks. Both shapes collapse to a list of blocks here.
 */
export function parseReport(report: unknown): ParsedReport {
  if (report === null || report === undefined) return { kind: "empty" };
  if (!isRecord(report)) return { kind: "opaque", raw: report };

  const blocks: SensorBlock[] = [];
  if (looksLikeSensorBlock(report)) blocks.push(toBlock(report));
  for (const entry of asArray(report.runs)) {
    if (isRecord(entry) && looksLikeSensorBlock(entry)) blocks.push(toBlock(entry));
  }

  if (blocks.length === 0) return { kind: "opaque", raw: report };
  return { kind: "sensor", blocks, raw: report };
}

/** The flags worth surfacing above the tables, in severity order. */
export function alarms(block: SensorBlock): string[] {
  const out: string[] = [];
  if (block.secret_probe?.decoy_in_egress) out.push("decoy secret left the sandbox");
  if (block.secret_probe?.decoy_read) out.push("decoy secret was read");
  if (block.derived?.egress_to_unknown_host) out.push("egress to an unknown host");
  if (block.derived?.wrote_sensitive) out.push("wrote to a sensitive path");
  if (block.derived?.wrote_outside_workspace) out.push("wrote outside the workspace");
  return out;
}
