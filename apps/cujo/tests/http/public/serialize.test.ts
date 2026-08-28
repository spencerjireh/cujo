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
  createdAt: true,
  updatedAt: true,
};

const EVERY_PROJECTION_FIELD: Record<keyof Projection, true> = {
  status: true,
  turnIds: true,
  checks: true,
  review: true,
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

  it("withholds the fields that name a person or a harness handle", () => {
    expect(WITHHELD_SOURCE_FIELDS).toContain("approver");
    expect(WITHHELD_SOURCE_FIELDS).toContain("decidedAt");
    expect(WITHHELD_SOURCE_FIELDS).toContain("sessionId");
    expect(WITHHELD_SOURCE_FIELDS).toContain("turnIds");
    expect(WITHHELD_SOURCE_FIELDS).toContain("approval");
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
      "SENTINEL_sessionId",
      "SENTINEL_turnIds",
      "SENTINEL_projectionTurnIds",
      "SENTINEL_approvalThreadId",
      "SENTINEL_approvalToolCallId",
      "SENTINEL_sourceEventId",
      // Shaped out of the review: a harness handle and the agent's own
      // unvalidated tool-call payload.
      "SENTINEL_toolCallId",
      "SENTINEL_rawAgentFinding",
    ]) {
      expect(json).not.toContain(leaked);
    }
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
