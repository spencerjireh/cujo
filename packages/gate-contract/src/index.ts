/**
 * The gate contract (decision 180): what a plugin receives and returns, what a
 * verdict is, and what the signed statement about a verdict carries. The
 * pages in `docs/gate/` describe the pipeline these shapes flow through;
 * this file is the one place the shapes are typed.
 *
 * Every object is `.strict()`. A plugin that adds a field it was not asked
 * for is a plugin whose output nothing checked, and the gate reads it as
 * invalid rather than guessing (`gate.output_invalid`). Severity words are
 * the ones `apps/cujo` already uses, so the port keeps its vocabulary.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What a plugin is allowed to claim: a `judge` reads, the other three run something. */
export const PLUGIN_KINDS = ["static", "exec", "proof", "judge"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

export const SEVERITIES = ["info", "warn", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERDICT_STATUSES = ["pass", "fail", "indeterminate"] as const;
export type VerdictStatus = (typeof VERDICT_STATUSES)[number];

/** What backs a finding: something ran, something was read, or nothing. */
export const COVERAGE_CLASSES = ["proven", "judged", "needs_human"] as const;
export type CoverageClass = (typeof COVERAGE_CLASSES)[number];

export const TREES = ["base", "head"] as const;
export type Tree = (typeof TREES)[number];

export const PLUGIN_STATUSES = ["ok", "error", "timeout", "skipped"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const EVIDENCE_KINDS = [
  "test",
  "counterexample",
  "mutant",
  "proof",
  "sensor",
  "reading",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The evidence kinds that came from running something. Only these can block. */
export const EXECUTED_EVIDENCE_KINDS = [
  "test",
  "counterexample",
  "mutant",
  "proof",
  "sensor",
] as const;
export type ExecutedEvidenceKind = (typeof EXECUTED_EVIDENCE_KINDS)[number];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `<plugin id>.<rule>`: lowercase, stable, listed in the plugin's manifest. */
export const RuleCodeSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9_]*$/);
export type RuleCode = z.infer<typeof RuleCodeSchema>;

export const PluginIdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type PluginId = z.infer<typeof PluginIdSchema>;

export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);

export const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const PluginRefSchema = z.object({ id: PluginIdSchema, version: SemverSchema }).strict();
export type PluginRef = z.infer<typeof PluginRefSchema>;

// ---------------------------------------------------------------------------
// Evidence and findings
// ---------------------------------------------------------------------------

export const EvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("test"),
      tree: z.enum(TREES),
      command: z.string().min(1).max(4096),
      exit: z.number().int(),
      excerpt: z.string().max(4000),
      /** The same command on the other tree, when it ran. */
      baseline: z.object({ exit: z.number().int() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("counterexample"),
      property: z.string().min(1).max(2000),
      input: z.string().max(4000),
      output: z.string().max(4000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mutant"),
      path: z.string().min(1).max(1024),
      line: z.number().int().min(1),
      mutation: z.string().min(1).max(2000),
      /** A killed mutant is not evidence of anything; only a survivor is. */
      survived: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("proof"),
      goal: z.string().min(1).max(2000),
      prover: z.string().min(1).max(80),
      result: z.enum(["failed", "unproven"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sensor"),
      sensor: z.string().min(1).max(40),
      observation: z.string().min(1).max(2000),
      tree: z.enum(TREES).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reading"),
      excerpt: z.string().max(4000),
      rationale: z.string().min(1).max(2000),
    })
    .strict(),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const LocationSchema = z
  .object({
    path: z.string().min(1).max(1024),
    line: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    side: z.enum(TREES).optional(),
  })
  .strict()
  .refine((l) => l.endLine === undefined || l.line === undefined || l.endLine >= l.line, {
    message: "endLine is before line",
  });
export type Location = z.infer<typeof LocationSchema>;

const findingFields = {
  rule: RuleCodeSchema,
  severity: z.enum(SEVERITIES),
  title: z.string().min(1).max(200),
  message: z.string().max(4000).optional(),
  evidence: z.array(EvidenceSchema).max(20),
  location: LocationSchema.optional(),
  /** SARIF's partial fingerprint: the fold matches base to head on rule, path and this. */
  fingerprint: z.string().min(1).max(128).optional(),
};

/** What a plugin emits: a finding on one tree, before the fold. */
export const PluginFindingSchema = z.object({ ...findingFields, tree: z.enum(TREES) }).strict();
export type PluginFinding = z.infer<typeof PluginFindingSchema>;

/** The class the core derives from the evidence; a plugin never sets it. */
export function coverageOf(evidence: readonly Evidence[]): CoverageClass {
  if (evidence.some((e) => e.kind !== "reading")) return "proven";
  if (evidence.length > 0) return "judged";
  return "needs_human";
}

/** A finding in a verdict: on head, attributed to its plugin, with its coverage. */
export const FindingSchema = z
  .object({
    ...findingFields,
    pluginId: PluginIdSchema,
    pluginVersion: SemverSchema,
    coverage: z.enum(COVERAGE_CLASSES),
    blocking: z.boolean(),
  })
  .strict()
  .refine((f) => f.coverage === coverageOf(f.evidence), {
    message: "coverage does not follow from the evidence",
  });
export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------
// Plugin manifest, input and output
// ---------------------------------------------------------------------------

export const PluginManifestSchema = z
  .object({
    id: PluginIdSchema,
    version: SemverSchema,
    kind: z.enum(PLUGIN_KINDS),
    description: z.string().min(1).max(300),
    rules: z
      .array(
        z
          .object({
            code: RuleCodeSchema,
            title: z.string().min(1).max(200),
            defaultSeverity: z.enum(SEVERITIES),
            evidence: z.enum(["executed", "reading"]),
          })
          .strict(),
      )
      .min(1),
    needs: z
      .object({
        trees: z.array(z.enum(TREES)).min(1),
        sandbox: z.boolean(),
        network: z.boolean().default(false),
      })
      .strict(),
    timeoutMs: z.number().int().min(1).max(3_600_000),
    settingsSchema: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    for (const [i, rule] of m.rules.entries()) {
      if (!rule.code.startsWith(`${m.id}.`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", i, "code"],
          message: `rule code is not under plugin id "${m.id}"`,
        });
      }
    }
  });
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const ChangedFileSchema = z
  .object({
    path: z.string().min(1).max(1024),
    status: z.enum(["added", "modified", "removed", "renamed"]),
    additions: z.number().int().min(0).optional(),
    deletions: z.number().int().min(0).optional(),
  })
  .strict();
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const SnapshotSchema = z
  .object({
    repo: z.string().min(1).max(200),
    baseSha: ShaSchema,
    headSha: ShaSchema,
    prNumber: z.number().int().min(1).optional(),
    changedFiles: z.array(ChangedFileSchema).max(2000),
    /** Where each tree is checked out, for the trees the plugin asked for. */
    trees: z
      .object({
        base: z.string().min(1).max(1024).optional(),
        head: z.string().min(1).max(1024).optional(),
      })
      .strict(),
  })
  .strict();
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** The one JSON document a plugin reads on stdin. */
export const PluginInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    plugin: PluginRefSchema,
    snapshot: SnapshotSchema,
    /** The plugin's section of `.cujo.yml` at base; never from the head. */
    settings: z.record(z.unknown()),
    limits: z
      .object({
        timeoutMs: z.number().int().min(1),
        maxFindings: z.number().int().min(1).default(500),
        maxOutputBytes: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();
export type PluginInput = z.infer<typeof PluginInputSchema>;

/** The one JSON document a plugin writes on stdout. */
export const PluginOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    plugin: PluginRefSchema,
    status: z.enum(PLUGIN_STATUSES),
    findings: z.array(PluginFindingSchema).max(500),
    coverage: z
      .object({ note: z.string().min(1).max(300) })
      .strict()
      .optional(),
    error: z.string().min(1).max(2000).optional(),
    durationMs: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.status === "ok") return;
    if (o.error) return;
    if (o.status === "skipped" && o.coverage?.note) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["error"],
      message: `status "${o.status}" needs an error`,
    });
  });
export type PluginOutput = z.infer<typeof PluginOutputSchema>;

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/** What the verdict is a function of. The same binding means the same verdict. */
export const BindingSchema = z
  .object({
    repo: z.string().min(1).max(200),
    baseSha: ShaSchema,
    headSha: ShaSchema,
    prNumber: z.number().int().min(1).optional(),
    plugins: z.array(PluginRefSchema),
    /** Of `.cujo.yml` at base, or of the empty string when there is none. */
    configDigest: DigestSchema,
    /** Null when no plugin needed the sandbox. */
    sandboxImageDigest: DigestSchema.nullable(),
    gateVersion: SemverSchema,
  })
  .strict();
export type Binding = z.infer<typeof BindingSchema>;

const countsOf = <T extends string>(keys: readonly T[]) =>
  z
    .object(
      Object.fromEntries(keys.map((k) => [k, z.number().int().min(0)])) as Record<T, z.ZodNumber>,
    )
    .strict();

export const VerdictSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(VERDICT_STATUSES),
    binding: BindingSchema,
    coverage: z
      .object({
        class: z.enum(COVERAGE_CLASSES),
        counts: countsOf(COVERAGE_CLASSES),
        plugins: z.array(
          z
            .object({
              id: PluginIdSchema,
              version: SemverSchema,
              kind: z.enum(PLUGIN_KINDS),
              status: z.enum(PLUGIN_STATUSES),
              durationMs: z.number().int().min(0).optional(),
              note: z.string().min(1).max(300).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    findings: z.array(FindingSchema),
    policy: z
      .object({
        llmBlocks: z.boolean(),
        severityFloor: z.enum(SEVERITIES),
        source: z.enum(["base", "default"]),
      })
      .strict(),
    summary: z
      .object({
        headline: z.string().min(1).max(200),
        counts: countsOf(SEVERITIES),
        blocking: z.number().int().min(0),
        /** Only a `fail` or `indeterminate` verdict has detail; a pass is one line. */
        detail: z.string().min(1).max(20_000).optional(),
      })
      .strict(),
    producedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const blocking = v.findings.filter((f) => f.blocking);
    if (v.status === "fail" && blocking.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a fail verdict has no blocking finding",
      });
    }
    if (v.status === "pass" && blocking.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a pass verdict has a blocking finding",
      });
    }
    for (const [i, f] of v.findings.entries()) {
      if (f.blocking && f.coverage !== "proven" && !v.policy.llmBlocks) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings", i, "blocking"],
          message: "a finding without executed evidence blocks only when the repository opted in",
        });
      }
    }
    if (v.status === "pass" && v.summary.detail !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "detail"],
        message: "a pass verdict has no detail",
      });
    }
    if (v.summary.blocking !== blocking.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "blocking"],
        message: "summary.blocking does not count the blocking findings",
      });
    }
    for (const s of SEVERITIES) {
      const n = v.findings.filter((f) => f.severity === s).length;
      if (v.summary.counts[s] !== n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["summary", "counts", s],
          message: `summary.counts.${s} does not count the findings`,
        });
      }
    }
  });
export type Verdict = z.infer<typeof VerdictSchema>;

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const VERDICT_PREDICATE_TYPE = "https://cujo.dev/gate/verdict/v1";
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";

/**
 * The in-toto statement the gate signs. Its evidence kind is always
 * `re-executed`: the gate ran the checks itself and attests nothing a pull
 * request reported about itself.
 */
export const AttestationStatementSchema = z
  .object({
    _type: z.literal(IN_TOTO_STATEMENT_TYPE),
    subject: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            digest: z.object({ gitCommit: ShaSchema }).strict(),
          })
          .strict(),
      )
      .min(1),
    predicateType: z.literal(VERDICT_PREDICATE_TYPE),
    predicate: z
      .object({
        verdict: VerdictSchema,
        evidence: z.object({ kind: z.literal("re-executed") }).strict(),
        signer: z.object({ keyid: z.string().min(1).max(128) }).strict(),
      })
      .strict(),
  })
  .strict()
  .refine((s) => s.subject[0]?.digest.gitCommit === s.predicate.verdict.binding.headSha, {
    message: "the subject is not the verdict's head",
    path: ["subject", 0, "digest", "gitCommit"],
  });
export type AttestationStatement = z.infer<typeof AttestationStatementSchema>;

const base64 = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** The DSSE envelope around a serialized statement. */
export const DsseEnvelopeSchema = z
  .object({
    payloadType: z.literal(DSSE_PAYLOAD_TYPE),
    payload: base64,
    signatures: z
      .array(z.object({ keyid: z.string().min(1).max(128), sig: base64 }).strict())
      .min(1),
  })
  .strict();
export type DsseEnvelope = z.infer<typeof DsseEnvelopeSchema>;
