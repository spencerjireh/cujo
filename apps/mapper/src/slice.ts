/**
 * The slice a review reads (decision 172).
 *
 * Two engine tools, and the choice between them is the finding the spike
 * produced. `detect_changes` maps a diff to the symbols it reaches, with a
 * hop distance; `query_graph` answers "who uses this" in openCypher.
 *
 * **Not `trace_path`.** It looks like the right tool and it is not: it
 * traverses `CALLS` and leaves `CALL_REFERENCE` alone, so a function passed
 * as a value — `findings.filter(isMaliceClaim)` — has no caller as far as it
 * is concerned. The graph holds that edge; only the convenience tool drops
 * it. A reviewer told "nothing calls this" about a function three things use
 * is worse served than one told nothing at all.
 *
 * Paging is not optional either. `detect_changes --format json` returned 72
 * of 141 impacted symbols on this repository's own diff, with an empty
 * module summary and `continuation_requires_higher_budget`, so a single call
 * is a silently partial answer.
 */

import type { Engine } from "./engine";

export interface SliceRequest {
  project: string;
  /** The commit the pull request is measured against, as the graph knows it. */
  base: string;
  /** How far to follow the blast radius. The engine's own default is 2. */
  depth?: number;
  /** Stop after this many impacted symbols however many pages remain. */
  maxImpacted?: number;
}

interface ImpactedSymbol {
  qn: string;
  label: string;
  file: string;
  hop: number;
}

export interface Slice {
  changed_files: string[];
  impacted: ImpactedSymbol[];
  /** What the engine said it had, against what this answer carries. */
  impacted_total: number;
  truncated: boolean;
}

/** Pages the engine owes us, bounded so a pathological diff cannot spin. */
const MAX_PAGES = 20;

export async function buildSlice(engine: Engine, request: SliceRequest): Promise<Slice> {
  const maxImpacted = request.maxImpacted ?? 400;
  const changed = new Set<string>();
  const impacted: ImpactedSymbol[] = [];
  let impactedTotal = 0;
  let cursor: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages += 1;
    const page = await engine.run<DetectChanges>("detect_changes", {
      project: request.project,
      since: request.base,
      scope: "impact",
      direction: "inbound",
      depth: request.depth ?? 2,
      impact_cursor: cursor,
    });
    for (const file of page.changed_files ?? []) changed.add(file);
    for (const row of page.impacted ?? []) {
      if (impacted.length >= maxImpacted) break;
      impacted.push({
        qn: row.qn ?? "",
        label: row.label ?? "",
        file: row.file ?? "",
        hop: typeof row.hop === "number" ? row.hop : 0,
      });
    }
    impactedTotal = typeof page.impacted_total === "number" ? page.impacted_total : impacted.length;
    cursor = page.impacted_next_cursor;
    if (!page.impacted_has_more || cursor === undefined || impacted.length >= maxImpacted) break;
  }

  return {
    changed_files: [...changed].sort(),
    impacted,
    impacted_total: impactedTotal,
    truncated: impacted.length < impactedTotal,
  };
}

/** A symbol name this service will splice into a query, and nothing else. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

export class BadSymbolError extends Error {
  constructor(name: string) {
    super(`not a symbol name: ${name.slice(0, 40)}`);
    this.name = "BadSymbolError";
  }
}

/**
 * Everything that reaches a symbol, by every edge the graph has rather than
 * by calls alone. `USAGE` is what a type has; `CALL_REFERENCE` is what a
 * function passed as a value has; both are what "who would this break?"
 * means.
 *
 * The engine's Cypher subset takes no parameters — it fails loudly on `$x`
 * rather than returning nothing — so the name is spliced. It is checked
 * against an identifier shape first and refused otherwise: a name is the one
 * piece of this query that comes from outside, and a quote in it would end
 * the string literal.
 */
export async function usersOf(
  engine: Engine,
  project: string,
  name: string,
): Promise<{ user: string; edge: string; file: string }[]> {
  if (!IDENTIFIER.test(name)) throw new BadSymbolError(name);
  const answer = await engine.run<QueryGraph>("query_graph", {
    project,
    query: `MATCH (a)-[r]->(b) WHERE b.name = '${name}' RETURN a.qualified_name AS user, type(r) AS edge, a.file_path AS file ORDER BY user`,
  });
  return rowsOf(answer).map((row) => ({
    user: String(row.user ?? ""),
    edge: String(row.edge ?? ""),
    file: String(row.file ?? ""),
  }));
}

/**
 * `query_graph` answers with a `columns` list and `rows` of positional
 * arrays, not with objects — the compact shape its whole output format is
 * built around. Zipped here once so no caller has to know that.
 */
function rowsOf(answer: QueryGraph): Record<string, unknown>[] {
  const columns = answer.columns ?? [];
  return (answer.rows ?? []).map((row) => {
    const out: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      out[column] = row[index];
    });
    return out;
  });
}

interface DetectChanges {
  changed_files?: string[];
  impacted?: { qn?: string; label?: string; file?: string; hop?: number }[];
  impacted_total?: number;
  impacted_has_more?: boolean;
  impacted_next_cursor?: string;
}

interface QueryGraph {
  columns?: string[];
  rows?: unknown[][];
}
