/**
 * Which detonations a run may reuse, and which of its own may be reused
 * (decision 145).
 *
 * Both halves are pure over what the trusted side already holds: the
 * specifiers a pull request adds, read off its manifest hunks; and the
 * detonation entries a finished run's report carries. The store between
 * them is `DetonationCacheStore`.
 */

import type {
  DetonationCacheStore,
  RunCachedDetonation,
  CachedDetonation as StoredDetonation,
} from "../store/detonations";
import { validateReport } from "./report-schema";
import { type AddedSpecifier, type Source, isExact, normalizeSpecifier } from "./specifiers";
import type { CheckState, Projection } from "./types";

/**
 * One entry as the brief carries it, field by field and never a spread of a
 * store row. No report: the evidence stays on the trusted side and the fold
 * substitutes it for the sub-agent's stub (decision 148), so the model
 * carries a key and a date, not thirty kilobytes.
 */
export interface CachedDetonation {
  dependency: string;
  source: Source;
  /** The producing run's id when that run is public, else null (decision 36). */
  run_id: string | null;
  cached_at: string;
}

/**
 * Hosts an install may talk to without the entry being tied to one
 * repository's allowlist. The same set as `KNOWN_INDEX_HOSTS` in
 * `sandbox/cujo_sniff/policy.py`, and a test holds the two together: an
 * entry whose egress is all index hosts says the same thing in every
 * repository, while one that reached a host a repository allowed says it
 * only there.
 */
export const INDEX_HOSTS: ReadonlySet<string> = new Set([
  "pypi.org",
  "files.pythonhosted.org",
  "registry.npmjs.org",
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "rubygems.org",
  "index.rubygems.org",
]);

const SOURCES: ReadonlySet<string> = new Set(["pypi", "npm", "gem", "go"]);

/**
 * The cached entries for the exact specifiers this head adds, in the order
 * they were added: what the brief carries, and what the run keeps for the
 * fold to substitute (decision 148).
 */
export function lookupCachedDetonations(
  store: Pick<DetonationCacheStore, "get">,
  added: readonly AddedSpecifier[],
  now: Date,
): { brief: CachedDetonation[]; kept: RunCachedDetonation[] } {
  const brief: CachedDetonation[] = [];
  const kept: RunCachedDetonation[] = [];
  for (const spec of added) {
    if (!spec.exact) continue;
    const hit: StoredDetonation | null = store.get(spec.source, spec.specifier, now);
    if (!hit) continue;
    const cachedFromRun = hit.runIsPublic ? hit.runId : null;
    brief.push({
      dependency: hit.specifier,
      source: hit.source,
      run_id: cachedFromRun,
      cached_at: hit.createdAt,
    });
    kept.push({
      source: hit.source,
      specifier: hit.specifier,
      report: hit.report,
      cachedFromRun,
      cachedAt: hit.createdAt,
    });
  }
  return { brief, kept };
}

export interface CacheableDetonation {
  source: Source;
  specifier: string;
  report: unknown;
}

interface DependencyEntry {
  dependency: string;
  source: string;
  install_ok: boolean;
  window_exclusive: boolean;
  cached_from_run?: unknown;
  cached?: unknown;
  derived: Record<string, unknown>;
  egress: { host: string }[];
  secret_probe?: { decoy_read?: unknown };
}

function isDependencyEntry(entry: unknown): entry is DependencyEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.dependency === "string" && typeof e.source === "string";
}

/**
 * The entries of a run's detonation reports that may serve another run:
 * the install succeeded under an exclusive sensor window, no hard rule
 * tripped (no sensitive write, no unknown host, no decoy read), every host reached is an index host, the
 * specifier is exact, and the entry is not itself a cached copy. Anything else is that run's own business.
 */
export function cacheableDetonations(
  projection: Pick<Projection, "checks">,
): CacheableDetonation[] {
  const out: CacheableDetonation[] = [];
  for (const check of projection.checks as readonly CheckState[]) {
    if (check.title !== "detonation" || check.status !== "done") continue;
    const validated = validateReport(check.report);
    if (!validated.ok) continue;
    const runs = (check.report as { runs?: unknown[] }).runs ?? [];
    for (const entry of runs) {
      if (!isDependencyEntry(entry)) continue;
      if (!SOURCES.has(entry.source)) continue;
      const source = entry.source as Source;
      if (!entry.install_ok || !entry.window_exclusive) continue;
      if (entry.cached_from_run !== undefined && entry.cached_from_run !== null) continue;
      if (entry.cached === true) continue;
      // The flags a hard rule reads (Contract 3), not every flag the sensors
      // derive: every pip install writes `~/.cache/pip`, which is
      // `wrote_outside_workspace` and a finding for nobody, and an install's
      // own child process is `spawned_subprocess`. Neither says the thing is
      // unsafe to reuse; the three below do.
      const derived = entry.derived ?? {};
      if (derived.wrote_sensitive === true || derived.egress_to_unknown_host === true) continue;
      if (entry.secret_probe?.decoy_read === true) continue;
      if ((entry.egress ?? []).some((row) => !INDEX_HOSTS.has(row.host))) continue;
      const specifier = normalizeSpecifier(source, entry.dependency);
      if (!isExact(source, specifier)) continue;
      out.push({ source, specifier, report: entry });
    }
  }
  return out;
}
