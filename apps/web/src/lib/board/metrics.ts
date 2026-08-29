/**
 * The numbers on the readout rack, derived from the one list request the board
 * already makes.
 *
 * Pure, so the data-layer test covers it — this app runs vitest without a DOM
 * on purpose, and everything here is arithmetic over `RunSummary[]`.
 *
 * The rule that shapes every function below: a run that measured nothing is
 * excluded from an average rather than counted as zero, and the count of runs
 * that *did* measure is reported beside the number. A p50 over four runs out of
 * twenty-six is a different claim from a p50 over twenty-six, and the rack says
 * which one it is showing.
 */

import { CHECK_NAMES, type CheckName, RUN_STATUSES, type RunStatus } from "@/lib/api/types";
import type { RunSummary } from "@/lib/api/types";
import { isLive } from "@/lib/api/types";
import { type CheckOutcome, checkOutcome, checksOf, statusTone } from "./tone";
import type { Tone } from "./tone";

export interface VerdictSlice {
  status: RunStatus;
  tone: Tone;
  count: number;
  /** Share of the whole record, 0–1. Zero when there are no runs at all. */
  share: number;
}

export interface SensorRow {
  name: CheckName;
  done: number;
  error: number;
  running: number;
  /** Runs whose digest exists but has no entry for this check. */
  absent: number;
  /** Runs with a digest at all, which is what the three counts above sum to. */
  observed: number;
  /** Median duration in ms across the runs where this check reported one. */
  medianMs: number | null;
  /** How many runs contributed to `medianMs`. */
  measured: number;
}

export interface ActivityBucket {
  /** Start of the bucket, ISO, so the axis can label it without a clock. */
  startsAt: string;
  count: number;
}

export interface DurationSummary {
  p50: number | null;
  p95: number | null;
  fastest: number | null;
  slowest: number | null;
  /** Runs that reported a duration. The rest are live, or predate the stamps. */
  measured: number;
}

export interface BoardMetrics {
  total: number;
  live: number;
  awaitingApproval: number;
  /** Runs whose digest is missing entirely, so nothing below counts them. */
  unmeasured: number;
  repos: number;
  pullRequests: number;
  newestAt: string | null;
  verdicts: VerdictSlice[];
  sensors: SensorRow[];
  activity: ActivityBucket[];
  duration: DurationSummary;
}

/** Nearest-rank percentile. Null on an empty set rather than zero. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? null;
}

function verdicts(runs: RunSummary[]): VerdictSlice[] {
  const counts = new Map<RunStatus, number>();
  for (const run of runs) counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  // `RUN_STATUSES` order, not insertion order: the ribbon must not resequence
  // itself every time a run lands.
  return RUN_STATUSES.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => {
    const count = counts.get(status) ?? 0;
    return {
      status,
      tone: statusTone(status),
      count,
      share: runs.length === 0 ? 0 : count / runs.length,
    };
  });
}

function sensors(runs: RunSummary[]): SensorRow[] {
  return CHECK_NAMES.map((name) => {
    const tally: Record<CheckOutcome, number> = { done: 0, error: 0, running: 0, absent: 0 };
    const durations: number[] = [];
    let observed = 0;
    for (const run of runs) {
      // A run with no digest is not evidence about this check either way, so
      // it is not counted as `absent` — that word means the fold saw the other
      // checks and not this one.
      if (!run.digest) continue;
      observed += 1;
      const check = checksOf(run)[name];
      tally[checkOutcome(check)] += 1;
      if (check?.ms !== null && check?.ms !== undefined) durations.push(check.ms);
    }
    return {
      name,
      done: tally.done,
      error: tally.error,
      running: tally.running,
      absent: tally.absent,
      observed,
      medianMs: percentile(durations, 50),
      measured: durations.length,
    };
  });
}

const HOUR = 3_600_000;

/**
 * Bucket sizes the axis will use, coarsening as the window grows. A single
 * hour-or-day choice put a two-day board into three fat bars, which is not a
 * distribution — it is three numbers drawn large.
 */
const BUCKET_LADDER = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 7 * 24 * HOUR];

/** How many buckets the strip wants: enough to have a shape, few enough to see. */
export function bucketSize(spanMs: number, maxBuckets: number): number {
  return (
    BUCKET_LADDER.find((size) => spanMs / size + 1 <= maxBuckets) ??
    BUCKET_LADDER[BUCKET_LADDER.length - 1] ??
    HOUR
  );
}

/**
 * One bucket per slice of the window the list covers, oldest first, with the
 * empty ones kept. A sparkline that silently drops quiet hours draws a busy
 * night and a quiet week identically.
 */
export function activity(runs: RunSummary[], maxBuckets = 60): ActivityBucket[] {
  const stamps = runs
    .map((run) => Date.parse(run.created_at))
    .filter((value) => Number.isFinite(value));
  if (stamps.length === 0) return [];

  const first = Math.min(...stamps);
  const last = Math.max(...stamps);
  const size = bucketSize(last - first, maxBuckets);

  const floor = (at: number) => Math.floor(at / size) * size;
  const start = floor(first);
  const end = floor(last);
  const counts = new Map<number, number>();
  for (const at of stamps) counts.set(floor(at), (counts.get(floor(at)) ?? 0) + 1);

  const buckets: ActivityBucket[] = [];
  for (let at = start; at <= end; at += size) {
    buckets.push({ startsAt: new Date(at).toISOString(), count: counts.get(at) ?? 0 });
  }
  return buckets;
}

function duration(runs: RunSummary[]): DurationSummary {
  const values = runs
    .map((run) => run.digest?.durationMs)
    .filter((ms): ms is number => typeof ms === "number");
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    fastest: values.length === 0 ? null : Math.min(...values),
    slowest: values.length === 0 ? null : Math.max(...values),
    measured: values.length,
  };
}

export function boardMetrics(runs: RunSummary[]): BoardMetrics {
  const newest = runs
    .map((run) => run.updated_at)
    .filter((at) => Number.isFinite(Date.parse(at)))
    .sort()
    .at(-1);

  return {
    total: runs.length,
    live: runs.filter((run) => isLive(run.status)).length,
    awaitingApproval: runs.filter((run) => run.status === "blocked_pending").length,
    unmeasured: runs.filter((run) => !run.digest).length,
    repos: new Set(runs.map((run) => run.repo)).size,
    // A new head on the same pull request is a new run, so this is smaller
    // than `total` whenever anything was re-reviewed.
    pullRequests: new Set(runs.map((run) => `${run.repo}#${run.pr_number}`)).size,
    newestAt: newest ?? null,
    verdicts: verdicts(runs),
    sensors: sensors(runs),
    activity: activity(runs),
    duration: duration(runs),
  };
}
