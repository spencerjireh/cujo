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
  /**
   * `null` on every report the current sandbox writes: the proxy counts bytes
   * and never reads a payload, so nothing in there can tell whether the decoy's
   * value left the box. Distinct from `false`, which claimed an observation
   * nobody made, and from `undefined`, which is a report that predates the
   * field.
   */
  decoy_in_egress?: boolean | null;
}

export interface Derived {
  egress_to_unknown_host?: boolean;
  wrote_outside_workspace?: boolean;
  wrote_sensitive?: boolean;
  spawned_subprocess?: boolean;
}

/**
 * Whether one sensor was watching, and what the sandbox said about it. Absent
 * for a report written before the block existed, which is "unknown" and not
 * "off" — the UI shows the difference rather than guessing.
 */
export interface SensorHealth {
  armed?: boolean;
  detail?: string;
}

/**
 * The four sensors, by the names `sandbox/cujo_sniff/report.py` gives them.
 * Read as a map rather than four fields so a sensor added there renders here
 * without a change on this side.
 */
export type Sensors = Record<string, SensorHealth>;

/** Which caps cut this report short. A cut list is not an empty one. */
export interface Truncated {
  stdout_tail?: boolean;
  stderr_tail?: boolean;
  files_read?: boolean;
  snapshot?: boolean;
}

/** One sensor block, plus whatever identifying fields sat beside it. */
export interface SensorBlock {
  label: string | null;
  egress: EgressEntry[];
  files_read: FileReadEntry[];
  fs_changes: FsChangeEntry[];
  subprocesses: SubprocessEntry[];
  secret_probe: SecretProbe | null;
  sensors: Sensors | null;
  truncated: Truncated | null;
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
  return {
    decoy_read: bool(value.decoy_read),
    // `null` survives as `null`: it is the report saying it could not know,
    // which is a different thing from a `false` it measured.
    decoy_in_egress: value.decoy_in_egress === null ? null : bool(value.decoy_in_egress),
  };
}

function sensors(value: unknown): Sensors | null {
  if (!isRecord(value)) return null;
  const out: Sensors = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    out[name] = { armed: bool(entry.armed), detail: str(entry.detail) ?? undefined };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function truncated(value: unknown): Truncated | null {
  if (!isRecord(value)) return null;
  return {
    stdout_tail: bool(value.stdout_tail),
    stderr_tail: bool(value.stderr_tail),
    files_read: bool(value.files_read),
    snapshot: bool(value.snapshot),
  };
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

/**
 * What makes a record a sensor block rather than something no contract
 * describes. Any one of them is enough, so the list only ever grows: dropping
 * a name here sends a report that carries it to the raw view instead, with
 * nothing failing to say so.
 */
const SENSOR_KEYS = [
  "egress",
  "files_read",
  "fs_changes",
  "subprocesses",
  "secret_probe",
  "sensors",
  "truncated",
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
    sensors: sensors(value.sensors),
    truncated: truncated(value.truncated),
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

/** The daemons whose being off makes the rest of the block worth less. */
const WATCHED_SENSORS = ["proxy", "decoy"] as const;

/** The sensors that were not watching, by name. Empty when the block is absent. */
export function unarmed(block: SensorBlock): string[] {
  return WATCHED_SENSORS.filter((name) => block.sensors?.[name]?.armed === false);
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

/**
 * Whether this check is worth opening without being asked.
 *
 * A sensor that was off qualifies even though nothing tripped: it is the one
 * case where the tables are empty for a reason that has nothing to do with the
 * pull request, and a reader who leaves the card shut would take them at face
 * value. It is deliberately not one of `alarms`, though. A report renders one
 * card for the roll-up and one per run, and the roll-up is the pessimistic
 * summary of the runs -- so a single blind interval would raise the same chip
 * twice, counting one gap as two. The health strip says it once per card, and
 * says which run it was.
 */
export function needsAttention(block: SensorBlock): boolean {
  return alarms(block).length > 0 || unarmed(block).length > 0;
}
