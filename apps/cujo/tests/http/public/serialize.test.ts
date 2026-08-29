/**
 * The guard on the public wire shape (decision 34).
 *
 * Three layers, because each catches something the others cannot:
 *
 * 1. The two records below are typed `Record<keyof T, true>`, so adding a field
 *    to `RunRecord` or `Projection` is a compile error *here* until somebody
 *    writes it down. That is the fail-closed mechanism — the build goes red and
 *    the serializer never emitted the field in the first place.
 * 2. Set equality forces that acknowledgement to be a classification: the new
 *    name has to land in the public list or the withheld one.
 * 3. The sentinel sweep catches a leak nested inside a value, which neither of
 *    the first two would see — someone spreading a whole run into a sub-object.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_RUN_FIELDS,
  PUBLIC_SOURCE_FIELDS,
  PUBLIC_SUMMARY_FIELDS,
  WITHHELD_SOURCE_FIELDS,
  serializePublicRun,
  serializePublicSummary,
} from "../../../src/http/public/serialize";
import { emptyProjection } from "../../../src/review/fold";
import type { Projection, RunRecord } from "../../../src/review/types";

// Layer 1. Add a field to either type and this stops compiling.
const EVERY_RUN_FIELD: Record<keyof RunRecord, true> = {
  id: true,
  repo: true,
  prNumber: true,
  headSha: true,
  sessionId: true,
  turnIds: true,
  status: true,
  approver: true,
  decidedAt: true,
  isPublic: true,
  deliveryId: true,
  createdAt: true,
  updatedAt: true,
};

const EVERY_PROJECTION_FIELD: Record<keyof Projection, true> = {
  status: true,
  turnIds: true,
  checks: true,
  review: true,
  gatedReview: true,
  hardRuleHits: true,
  findings: true,
  approval: true,
  decision: true,
  externalResume: true,
  gatedResponseSeen: true,
  error: true,
  summary: true,
};

const sorted = (values: readonly string[]) => [...new Set(values)].sort();

describe("the public field allowlist", () => {
  it("classifies every field of both source types, and none twice", () => {
    const classified = [...PUBLIC_SOURCE_FIELDS, ...WITHHELD_SOURCE_FIELDS];
    const known = [...Object.keys(EVERY_RUN_FIELD), ...Object.keys(EVERY_PROJECTION_FIELD)];
    expect(sorted(classified)).toEqual(sorted(known));
    expect(classified).toHaveLength(new Set(classified).size);
  });

  it("withholds the fields that name a person, and the state of the gate", () => {
    expect(WITHHELD_SOURCE_FIELDS).toContain("approver");
    expect(WITHHELD_SOURCE_FIELDS).toContain("decidedAt");
    expect(WITHHELD_SOURCE_FIELDS).toContain("approval");
    expect(WITHHELD_SOURCE_FIELDS).toContain("decision");
    expect(WITHHELD_SOURCE_FIELDS).toContain("gatedResponseSeen");
  });

  it("publishes the harness and GitHub handles, which it used to withhold", () => {
    // Decision 54. They authorize nothing on their own: the TrueForge console
    // these name keeps its own Access application, and `delivery_id` is what
    // correlates a board page with a log line.
    for (const field of ["sessionId", "turnIds", "externalResume", "deliveryId"] as const) {
      expect(PUBLIC_SOURCE_FIELDS).toContain(field);
      expect(WITHHELD_SOURCE_FIELDS).not.toContain(field);
    }
  });
});

/**
 * Every string leaf is a distinct token, so anything the serializer copies can
 * be traced back to the field it came from wherever it ends up in the output.
 */
function sentinelView(): { run: RunRecord; projection: Projection } {
  const run: RunRecord = {
    id: "SENTINEL_id",
    repo: "SENTINEL_repo",
    prNumber: 7,
    headSha: "SENTINEL_headSha",
    sessionId: "SENTINEL_sessionId",
    turnIds: ["SENTINEL_turnIds"],
    status: "blocked_pending",
    approver: "SENTINEL_approver",
    decidedAt: "SENTINEL_decidedAt",
    isPublic: true,
    deliveryId: "SENTINEL_deliveryId",
    createdAt: "SENTINEL_createdAt",
    updatedAt: "SENTINEL_updatedAt",
  };
  const projection: Projection = {
    ...emptyProjection(),
    status: "blocked_pending",
    turnIds: ["SENTINEL_projectionTurnIds"],
    checks: [
      {
        threadId: "SENTINEL_threadId",
        title: "tests",
        isCheck: true,
        status: "done",
        report: { egress: ["SENTINEL_report"] },
        error: null,
        startedAt: "SENTINEL_startedAt",
        endedAt: "SENTINEL_endedAt",
      },
    ],
    review: {
      tool: "post_blocking_review",
      toolCallId: "SENTINEL_toolCallId",
      body: "SENTINEL_reviewBody",
      comments: [{ path: "a.py", line: 1, body: "SENTINEL_comment" }],
      findings: ["SENTINEL_rawAgentFinding"],
    },
    gatedReview: {
      tool: "post_gated_review",
      toolCallId: "SENTINEL_gatedToolCallId",
      body: "SENTINEL_gatedBody",
      comments: [{ path: "a.py", line: 2, body: "SENTINEL_gatedComment" }],
      findings: ["SENTINEL_rawGatedFinding"],
    },
    hardRuleHits: [
      {
        source: "hard_rule",
        check: "detonation",
        severity: "critical",
        title: "SENTINEL_hardRule",
        evidence: "SENTINEL_evidence",
      },
    ],
    findings: [
      {
        source: "hard_rule",
        check: "detonation",
        severity: "critical",
        title: "SENTINEL_finding",
        evidence: "SENTINEL_evidence",
      },
    ],
    approval: {
      threadId: "SENTINEL_approvalThreadId",
      toolCallId: "SENTINEL_approvalToolCallId",
      sourceEventId: "SENTINEL_sourceEventId",
    },
    externalResume: true,
    error: "SENTINEL_error",
    summary: "SENTINEL_summary",
  };
  return { run, projection };
}

describe("serializePublicRun", () => {
  it("emits exactly the public field list", () => {
    const body = serializePublicRun(sentinelView());
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_RUN_FIELDS].sort());
  });

  it("lets no withheld value through, however deeply it is nested", () => {
    const json = JSON.stringify(serializePublicRun(sentinelView()));
    for (const leaked of [
      "SENTINEL_approver",
      "SENTINEL_decidedAt",
      // The projection's own turn ids, which are rebuilt by the fold. The
      // run's are published (decision 54); these are a second copy of the same
      // fact and stay unread, so a leak here would mean the serializer started
      // reading the projection where it should read the record.
      "SENTINEL_projectionTurnIds",
      "SENTINEL_approvalThreadId",
      "SENTINEL_approvalToolCallId",
      "SENTINEL_sourceEventId",
      // Shaped out of the review: a harness handle and the agent's own
      // unvalidated tool-call payload.
      "SENTINEL_toolCallId",
      "SENTINEL_rawAgentFinding",
      // Nested one level down, inside a check. The top-level key assertions
      // cannot see this one, which is the reason this sweep exists.
      "SENTINEL_threadId",
      // The accusation, on a run that is still `blocked_pending`. Publishing
      // this is exactly what the gate prevents, and the audience here had no
      // way to allow it.
      "SENTINEL_gatedBody",
      "SENTINEL_gatedComment",
      "SENTINEL_gatedToolCallId",
      "SENTINEL_rawGatedFinding",
    ]) {
      expect(json).not.toContain(leaked);
    }
  });

  it("publishes the held review once a human confirmed it", () => {
    const view = sentinelView();
    view.run.status = "blocked_posted";
    view.projection.status = "blocked_posted";
    const json = JSON.stringify(serializePublicRun(view));
    // On the pull request now, so withholding it would hide the review the
    // board exists to show. Its harness handle and raw findings stay out.
    expect(json).toContain("SENTINEL_gatedBody");
    expect(json).toContain("SENTINEL_gatedComment");
    expect(json).not.toContain("SENTINEL_gatedToolCallId");
    expect(json).not.toContain("SENTINEL_rawGatedFinding");
  });

  it("still carries the findings, the review body and the check reports", () => {
    const json = JSON.stringify(serializePublicRun(sentinelView()));
    for (const kept of [
      "SENTINEL_finding",
      "SENTINEL_hardRule",
      "SENTINEL_reviewBody",
      "SENTINEL_comment",
      "SENTINEL_report",
      "SENTINEL_summary",
      // Published since decision 54, and from the record rather than the
      // projection.
      "SENTINEL_sessionId",
      "SENTINEL_turnIds",
      "SENTINEL_deliveryId",
    ]) {
      expect(json).toContain(kept);
    }
  });
});

describe("serializePublicSummary", () => {
  it("emits exactly the public summary field list", () => {
    const body = serializePublicSummary(sentinelView().run);
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_SUMMARY_FIELDS].sort());
  });

  it("names nobody", () => {
    const json = JSON.stringify(serializePublicSummary(sentinelView().run));
    expect(json).not.toContain("SENTINEL_approver");
    expect(json).not.toContain("SENTINEL_decidedAt");
  });
});

/**
 * The one rule here that no type system expresses: what this module is allowed
 * to depend on at all.
 *
 * It used to be stated as "never import from `../operator/`", because the way
 * to defeat the allowlist was to import the operator serializer and delete
 * fields from its result. Decision 54 deleted that directory, which would have
 * left a guard that passes because its target no longer exists — a green test
 * proving nothing. So the rule is inverted into a positive allowlist: these
 * are the modules the public plane may reach, and anything else is a new
 * dependency somebody has to write down here first.
 *
 * Biome 1.9's `noRestrictedImports` is a nursery rule matching exact module
 * specifiers rather than a directory, so this reads the source instead.
 * Unusual, and better than a comment nobody is obliged to obey.
 */
describe("the public module's imports", () => {
  const dir = join(import.meta.dirname, "../../../src/http/public");
  const IMPORT = /^\s*import[^;]*?from\s+["']([^"']+)["']/gm;

  const specifiersIn = (file: string): string[] => {
    const source = readFileSync(join(dir, file), "utf8");
    return [...source.matchAll(IMPORT)].map(([, specifier]) => specifier ?? "");
  };

  /**
   * Every specifier the plane may name. Anything reaching further — a client,
   * the runner's own dependencies, a notify module — is how a field nobody
   * classified arrives in a public response.
   */
  const ALLOWED = new Set([
    "hono",
    "hono/streaming",
    "./serialize",
    "./stream-limit",
    "../request-log",
    "../../review/runner.service",
    "../../review/types",
    "../../store",
  ]);

  it("reaches only the modules named here", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      for (const specifier of specifiersIn(file)) {
        if (!ALLOWED.has(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the imports it is checking, so the guard cannot pass vacuously", () => {
    expect(specifiersIn("index.ts")).toEqual(
      expect.arrayContaining(["hono", "./serialize", "./stream-limit"]),
    );
  });
});
