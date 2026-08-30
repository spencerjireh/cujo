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
  PUBLIC_DIGEST_CHECK_FIELDS,
  PUBLIC_DIGEST_FIELDS,
  PUBLIC_RUN_FIELDS,
  PUBLIC_SOURCE_FIELDS,
  PUBLIC_SUMMARY_FIELDS,
  WITHHELD_SOURCE_FIELDS,
  serializePublicRun,
  serializePublicSummary,
} from "../../../src/http/public/serialize";
import { deriveDigest } from "../../../src/review/digest";
import { emptyProjection } from "../../../src/review/fold";
import type { DigestCheck, Projection, RunDigest, RunRecord } from "../../../src/review/types";

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
  model: true,
  rubricSha256: true,
  prTitle: true,
  prAuthorLogin: true,
  prAuthorId: true,
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
  usage: true,
  setup: true,
};

/**
 * Layer 1 for the third source type (decision 65). Its own record rather than
 * a third arm of `SourceField`, because `checks` and `findings` are also keys
 * of `Projection` and the no-duplicate assertion below could not then be
 * stated. Adding a field to `RunDigest` still stops this file compiling.
 */
const EVERY_DIGEST_FIELD: Record<keyof RunDigest, true> = {
  checks: true,
  findings: true,
  durationMs: true,
};

/**
 * Layer 1 one level further down, which is where the guard above stops.
 *
 * `checks` is a key of `RunDigest` and was classified as one, and the
 * serializer then copied the whole object through by reference — so every field
 * of a `DigestCheck` was published by a list that had never named it. Adding
 * `sandboxMs` is what found that, and this is the record that closes it.
 */
const EVERY_DIGEST_CHECK_FIELD: Record<keyof DigestCheck, true> = {
  status: true,
  ms: true,
  sandboxMs: true,
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
    // Decision 57. They authorize nothing on their own: the TrueForge console
    // these name keeps its own Access application, and `delivery_id` is what
    // correlates a board page with a log line.
    for (const field of ["sessionId", "turnIds", "externalResume", "deliveryId"] as const) {
      expect(PUBLIC_SOURCE_FIELDS).toContain(field);
      expect(WITHHELD_SOURCE_FIELDS).not.toContain(field);
    }
  });

  /**
   * The one class of person this plane does name. Every row it serves is a run
   * where `isPublic` is true, so the title and the author are already
   * world-readable on the pull request itself — unlike `approver`, which names
   * a Cujo operator and appears nowhere else (decision 55).
   */
  it("publishes what the pull request already says about itself", () => {
    expect(PUBLIC_SOURCE_FIELDS).toContain("prTitle");
    expect(PUBLIC_SOURCE_FIELDS).toContain("prAuthorLogin");
    expect(PUBLIC_SOURCE_FIELDS).toContain("prAuthorId");
  });

  /**
   * The digest publishes every one of its keys, and it may: each is a count or
   * a duration over `checks` and `findings`, which this plane already serves in
   * full on the detail route. A key added to `RunDigest` that is *not* such a
   * reduction has to fail here, and it does — the record above stops compiling
   * and this list stops matching it.
   */
  it("classifies every field of the digest, and publishes all of them", () => {
    expect(sorted(PUBLIC_DIGEST_FIELDS)).toEqual(sorted(Object.keys(EVERY_DIGEST_FIELD)));
  });

  /**
   * And the same of one check inside it. Without this the list above is a
   * promise about `RunDigest` that reads like a promise about the payload.
   */
  it("classifies every field of a digest check, and publishes all of them", () => {
    expect(sorted(PUBLIC_DIGEST_CHECK_FIELDS)).toEqual(
      sorted(Object.keys(EVERY_DIGEST_CHECK_FIELD)),
    );
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
    model: "SENTINEL_model",
    rubricSha256: "SENTINEL_rubricSha256",
    prTitle: "SENTINEL_prTitle",
    prAuthorLogin: "SENTINEL_prAuthorLogin",
    prAuthorId: 4242,
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
  it("still emits every field for a projection stored before `usage` existed", () => {
    // The gap the sentinel fixture cannot show: it spreads `emptyProjection()`,
    // which always has `usage`, so the field-list assertion below passes while
    // a real stored row from before the field silently drops the key. Verified
    // against the deployed board, which is where it was found.
    const view = sentinelView();
    const { usage: _usage, ...stored } = view.projection;
    const body = serializePublicRun({ run: view.run, projection: stored as Projection });
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_RUN_FIELDS].sort());
    expect(body.usage).toBeNull();
  });

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
      // run's are published (decision 57); these are a second copy of the same
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
      // Published since decision 57, and from the record rather than the
      // projection.
      "SENTINEL_sessionId",
      "SENTINEL_turnIds",
      "SENTINEL_deliveryId",
      "SENTINEL_model",
      "SENTINEL_rubricSha256",
    ]) {
      expect(json).toContain(kept);
    }
  });
});

/** The sentinel run, with the digest the sentinel projection actually derives. */
function sentinelRow(): { run: RunRecord; digest: RunDigest | null } {
  const view = sentinelView();
  return { run: view.run, digest: deriveDigest(view.projection) };
}

describe("serializePublicSummary", () => {
  it("emits exactly the public summary field list", () => {
    const body = serializePublicSummary(sentinelRow());
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_SUMMARY_FIELDS].sort());
  });

  it("names no Cujo operator", () => {
    const json = JSON.stringify(serializePublicSummary(sentinelRow()));
    expect(json).not.toContain("SENTINEL_approver");
    expect(json).not.toContain("SENTINEL_decidedAt");
  });

  it("carries the title but not the author, which belongs to the run page", () => {
    const body = serializePublicSummary(sentinelRow());
    expect(body.pr_title).toBe("SENTINEL_prTitle");
    expect(JSON.stringify(body)).not.toContain("SENTINEL_prAuthorLogin");
  });

  /**
   * The digest is a reduction, so nothing a check *said* may ride out on it —
   * a row is not a place to publish a sensor report, and the sentinel check
   * carries one.
   */
  it("carries what the checks measured, not what they reported", () => {
    const body = serializePublicSummary(sentinelRow());
    expect(body.digest).toEqual({
      // `ms` and `durationMs` are null because the sentinel stamps are tokens
      // rather than dates — the same degradation a projection written by an
      // older fold gets.
      // `sandboxMs` is null for a third reason: the sentinel check has no
      // `timings`, which is exactly the shape a projection stored before the
      // field existed rehydrates with.
      checks: { tests: { status: "done", ms: null, sandboxMs: null } },
      findings: { critical: 1, warn: 0, info: 0 },
      durationMs: null,
    });
    const json = JSON.stringify(body);
    for (const leaked of ["SENTINEL_report", "SENTINEL_evidence", "SENTINEL_threadId"]) {
      expect(json).not.toContain(leaked);
    }
  });

  it("says how much of a check was the sandbox executing", () => {
    const view = sentinelView();
    const checks = view.projection.checks.map((check) =>
      check.title === "tests"
        ? { ...check, timings: { wallMs: 41_000, sandboxMs: 30_000 } }
        : check,
    );
    const body = serializePublicSummary({
      run: view.run,
      digest: deriveDigest({ ...view.projection, checks }),
    });
    expect(body.digest?.checks.tests?.sandboxMs).toBe(30_000);
  });

  /**
   * The `?? null` in `publicDigestCheck`, which is not decoration.
   *
   * `backfillDigest` re-derives only a *missing* digest, so every run folded
   * before this field existed keeps a blob without it — permanently. Parsed
   * back, the key is `undefined`; `JSON.stringify` drops it; and the payload
   * quietly loses a key this module promises to emit on every response.
   */
  it("emits the key for a digest stored before the field existed", () => {
    const stored = JSON.parse(
      JSON.stringify({
        checks: { tests: { status: "done", ms: 41_000 } },
        findings: {},
        durationMs: null,
      }),
    ) as RunDigest;
    const body = serializePublicSummary({ run: sentinelView().run, digest: stored });
    expect(body.digest?.checks.tests).toHaveProperty("sandboxMs");
    expect(body.digest?.checks.tests?.sandboxMs).toBeNull();
  });

  /**
   * A run claimed but never folded. Null rather than four zeroed checks: no
   * check ran, which the board must not draw as four that passed.
   */
  it("says nothing about the checks of a run that has no digest", () => {
    const body = serializePublicSummary({ run: sentinelView().run, digest: null });
    expect(body.digest).toBeNull();
  });
});

/**
 * The one rule here that no type system expresses: what this module is allowed
 * to depend on at all.
 *
 * It used to be stated as "never import from `../operator/`", because the way
 * to defeat the allowlist was to import the operator serializer and delete
 * fields from its result. Decision 57 deleted that directory, which would have
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
