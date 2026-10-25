import { describe, expect, it } from "vitest";
import {
  AttestationStatementSchema,
  DsseEnvelopeSchema,
  EVIDENCE_KINDS,
  EXECUTED_EVIDENCE_KINDS,
  EvidenceSchema,
  type Finding,
  PluginManifestSchema,
  PluginOutputSchema,
  RuleCodeSchema,
  type Verdict,
  VerdictSchema,
  coverageOf,
} from "../src/index";

const sha = (c: string) => c.repeat(40);
const digest = (c: string) => `sha256:${c.repeat(64)}`;

const manifest = {
  id: "tests",
  version: "1.0.0",
  kind: "exec",
  description: "Runs the declared test command on both trees.",
  rules: [
    {
      code: "tests.base_pass_head_fail",
      title: "A test passes on base and fails on head",
      defaultSeverity: "critical",
      evidence: "executed",
    },
  ],
  needs: { trees: ["base", "head"], sandbox: true },
  timeoutMs: 900_000,
};

const proven: Finding = {
  rule: "tests.base_pass_head_fail",
  severity: "critical",
  title: "test_x fails on head",
  evidence: [{ kind: "test", tree: "head", command: "pytest", exit: 1, excerpt: "1 failed" }],
  pluginId: "tests",
  pluginVersion: "1.0.0",
  coverage: "proven",
  blocking: true,
};

const judged: Finding = {
  rule: "judge.observation",
  severity: "warn",
  title: "A docstring disagrees with the code",
  evidence: [{ kind: "reading", excerpt: "half to even", rationale: "the code rounds half up" }],
  pluginId: "judge",
  pluginVersion: "1.0.0",
  coverage: "judged",
  blocking: false,
};

const verdict = (over: Partial<Verdict> = {}): Verdict => {
  const findings = over.findings ?? [proven];
  const count = (pred: (f: Finding) => boolean) => findings.filter(pred).length;
  return {
    schemaVersion: 1,
    status: "fail",
    binding: {
      repo: "o/r",
      baseSha: sha("a"),
      headSha: sha("b"),
      plugins: [{ id: "tests", version: "1.0.0" }],
      configDigest: digest("c"),
      sandboxImageDigest: null,
      gateVersion: "0.1.0",
    },
    coverage: {
      class: "proven",
      counts: {
        proven: count((f) => f.coverage === "proven"),
        judged: count((f) => f.coverage === "judged"),
        needs_human: count((f) => f.coverage === "needs_human"),
      },
      plugins: [{ id: "tests", version: "1.0.0", kind: "exec", status: "ok" }],
    },
    findings,
    policy: { llmBlocks: false, severityFloor: "critical", source: "default" },
    summary: {
      headline: "Blocked.",
      counts: {
        info: count((f) => f.severity === "info"),
        warn: count((f) => f.severity === "warn"),
        critical: count((f) => f.severity === "critical"),
      },
      blocking: count((f) => f.blocking),
      detail: "tests.base_pass_head_fail",
    },
    producedAt: "2026-10-25T00:00:00Z",
    ...over,
  };
};

describe("RuleCodeSchema", () => {
  it("accepts <plugin>.<rule>", () => {
    expect(RuleCodeSchema.parse("tests.base_pass_head_fail")).toBe("tests.base_pass_head_fail");
  });

  it.each(["Tests.x", "tests", "tests.", `t.${"a".repeat(80)}`])("refuses %j", (code) => {
    expect(RuleCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("vocabulary", () => {
  it("every executed evidence kind is an evidence kind, and reading is not executed", () => {
    for (const kind of EXECUTED_EVIDENCE_KINDS) expect(EVIDENCE_KINDS).toContain(kind);
    expect(EXECUTED_EVIDENCE_KINDS as readonly string[]).not.toContain("reading");
  });

  it("derives coverage from the evidence", () => {
    expect(coverageOf(proven.evidence)).toBe("proven");
    expect(coverageOf(judged.evidence)).toBe("judged");
    expect(coverageOf([])).toBe("needs_human");
  });
});

describe("PluginManifestSchema", () => {
  it("accepts a manifest and defaults network to false", () => {
    expect(PluginManifestSchema.parse(manifest).needs.network).toBe(false);
  });

  it("refuses an unknown kind", () => {
    expect(PluginManifestSchema.safeParse({ ...manifest, kind: "oracle" }).success).toBe(false);
  });

  it("refuses zero rules", () => {
    expect(PluginManifestSchema.safeParse({ ...manifest, rules: [] }).success).toBe(false);
  });

  it("refuses a rule code not under the plugin id", () => {
    const rules = [{ ...manifest.rules[0], code: "sensors.decoy_read" }];
    expect(PluginManifestSchema.safeParse({ ...manifest, rules }).success).toBe(false);
  });

  it("refuses a version that is not semver", () => {
    expect(PluginManifestSchema.safeParse({ ...manifest, version: "1.0" }).success).toBe(false);
  });
});

describe("EvidenceSchema", () => {
  it("refuses a mutant that did not survive", () => {
    const mutant = { kind: "mutant", path: "a.py", line: 1, mutation: "> to >=", survived: false };
    expect(EvidenceSchema.safeParse(mutant).success).toBe(false);
  });
});

describe("PluginOutputSchema", () => {
  const output = {
    schemaVersion: 1,
    plugin: { id: "tests", version: "1.0.0" },
    status: "ok",
    findings: [{ ...proven, tree: "head" }],
  };
  const {
    pluginId: _p,
    pluginVersion: _v,
    coverage: _c,
    blocking: _b,
    ...pluginFinding
  } = {
    ...proven,
    tree: "head",
  };

  it("accepts a finding on one tree", () => {
    expect(PluginOutputSchema.safeParse({ ...output, findings: [pluginFinding] }).success).toBe(
      true,
    );
  });

  it("refuses a verdict-side finding (an extra key)", () => {
    expect(PluginOutputSchema.safeParse(output).success).toBe(false);
  });

  it("refuses a finding with no tree", () => {
    const { tree: _t, ...noTree } = pluginFinding;
    expect(PluginOutputSchema.safeParse({ ...output, findings: [noTree] }).success).toBe(false);
  });

  it("refuses an error status without an error", () => {
    const errored = { ...output, findings: [], status: "error" };
    expect(PluginOutputSchema.safeParse(errored).success).toBe(false);
    expect(PluginOutputSchema.safeParse({ ...errored, error: "boom" }).success).toBe(true);
  });

  it("accepts a skipped status with a coverage note", () => {
    const skipped = { ...output, findings: [], status: "skipped", coverage: { note: "no tests" } };
    expect(PluginOutputSchema.safeParse(skipped).success).toBe(true);
  });
});

describe("VerdictSchema", () => {
  it("accepts a fail with one proven blocking finding", () => {
    expect(VerdictSchema.safeParse(verdict()).success).toBe(true);
  });

  it("refuses a fail with no blocking finding", () => {
    const v = verdict({ findings: [{ ...proven, blocking: false }] });
    expect(VerdictSchema.safeParse(v).success).toBe(false);
  });

  it("refuses a pass that carries a blocking finding or detail", () => {
    expect(VerdictSchema.safeParse(verdict({ status: "pass" })).success).toBe(false);
    const clean = verdict({ status: "pass", findings: [] });
    clean.summary.detail = undefined;
    expect(VerdictSchema.safeParse(clean).success).toBe(true);
    clean.summary.detail = "nothing";
    expect(VerdictSchema.safeParse(clean).success).toBe(false);
  });

  it("lets a judged finding block only when the repository opted in", () => {
    const v = verdict({ findings: [{ ...judged, blocking: true }] });
    expect(VerdictSchema.safeParse(v).success).toBe(false);
    v.policy = { ...v.policy, llmBlocks: true, source: "base" };
    expect(VerdictSchema.safeParse(v).success).toBe(true);
  });

  it("refuses a coverage class that does not follow from the evidence", () => {
    const v = verdict({ findings: [{ ...proven, coverage: "judged", blocking: false }] });
    expect(VerdictSchema.safeParse(v).success).toBe(false);
  });

  it("refuses a summary that does not count the findings", () => {
    const v = verdict();
    v.summary = { ...v.summary, counts: { ...v.summary.counts, warn: 1 } };
    expect(VerdictSchema.safeParse(v).success).toBe(false);
  });

  it("refuses a short sha and a bare digest", () => {
    const v = verdict();
    expect(
      VerdictSchema.safeParse({ ...v, binding: { ...v.binding, headSha: sha("b").slice(1) } })
        .success,
    ).toBe(false);
    expect(
      VerdictSchema.safeParse({ ...v, binding: { ...v.binding, configDigest: "c".repeat(64) } })
        .success,
    ).toBe(false);
  });
});

describe("AttestationStatementSchema", () => {
  const statement = (headSha: string) => ({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "o/r", digest: { gitCommit: headSha } }],
    predicateType: "https://cujo.dev/gate/verdict/v1",
    predicate: {
      verdict: verdict(),
      evidence: { kind: "re-executed" },
      signer: { keyid: "cujo-gate-2026" },
    },
  });

  it("accepts a statement about the verdict's head", () => {
    expect(AttestationStatementSchema.safeParse(statement(sha("b"))).success).toBe(true);
  });

  it("refuses a subject that is not the verdict's head", () => {
    expect(AttestationStatementSchema.safeParse(statement(sha("a"))).success).toBe(false);
  });

  it("needs at least one signature on the envelope", () => {
    const envelope = {
      payloadType: "application/vnd.in-toto+json",
      payload: "e30=",
      signatures: [],
    };
    expect(DsseEnvelopeSchema.safeParse(envelope).success).toBe(false);
    envelope.signatures.push({ keyid: "cujo-gate-2026", sig: "AAAA" } as never);
    expect(DsseEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });
});
