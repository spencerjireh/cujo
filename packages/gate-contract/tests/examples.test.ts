/**
 * The canonical examples in `docs/contracts/` against the schemas.
 *
 * The pages in `docs/gate/` describe these two files by name; a field renamed
 * here and not there is what this catches. The verdict example is the one
 * `docs/gate/verdict.md` walks through, and the plugin output is the pair
 * `docs/gate/pipeline.md` folds, so both have to keep their shape.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PluginOutputSchema, VerdictSchema } from "../src/index";

const example = (name: string) => {
  const text = readFileSync(join(import.meta.dirname, "../../../docs/contracts", name), "utf8");
  const { _comment: _, ...body } = JSON.parse(text);
  return body;
};

describe("docs/contracts/verdict.example.json", () => {
  const verdict = VerdictSchema.parse(example("verdict.example.json"));

  it("is a fail with one proven blocking finding", () => {
    expect(verdict.status).toBe("fail");
    const blocking = verdict.findings.filter((f) => f.blocking);
    expect(blocking.map((f) => f.rule)).toEqual(["tests.base_pass_head_fail"]);
    expect(blocking[0]?.coverage).toBe("proven");
  });

  it("carries one judged advisory finding and one coverage caveat", () => {
    const byCoverage = (c: string) => verdict.findings.filter((f) => f.coverage === c);
    expect(byCoverage("judged").map((f) => f.rule)).toEqual(["judge.observation"]);
    expect(byCoverage("needs_human").map((f) => f.rule)).toEqual(["sensors.unarmed"]);
    expect(verdict.findings.filter((f) => f.coverage !== "proven").every((f) => !f.blocking)).toBe(
      true,
    );
  });

  it("counts its findings in both summaries", () => {
    expect(verdict.coverage.counts).toEqual({ proven: 1, judged: 1, needs_human: 1 });
    expect(verdict.summary.counts).toEqual({ info: 0, warn: 2, critical: 1 });
    expect(verdict.summary.blocking).toBe(1);
  });

  it("names every plugin it ran in the binding", () => {
    const bound = verdict.binding.plugins.map((p) => p.id).sort();
    const ran = verdict.coverage.plugins.map((p) => p.id).sort();
    expect(ran).toEqual(bound);
    for (const f of verdict.findings) expect(bound).toContain(f.pluginId);
  });
});

describe("docs/contracts/plugin-output.example.json", () => {
  const output = PluginOutputSchema.parse(example("plugin-output.example.json"));

  it("has a base and a head finding sharing a fingerprint, and one head-only", () => {
    const byFingerprint = new Map<string, string[]>();
    for (const f of output.findings) {
      const key = `${f.rule}|${f.location?.path}|${f.fingerprint}`;
      byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), f.tree]);
    }
    const trees = [...byFingerprint.values()].map((t) => t.sort().join("+"));
    expect(trees.sort()).toEqual(["base+head", "head"]);
  });

  it("is the fold's input: after dropping head findings with a base match, one remains", () => {
    const base = new Set(
      output.findings
        .filter((f) => f.tree === "base")
        .map((f) => `${f.rule}|${f.location?.path}|${f.fingerprint}`),
    );
    const introduced = output.findings.filter(
      (f) => f.tree === "head" && !base.has(`${f.rule}|${f.location?.path}|${f.fingerprint}`),
    );
    expect(introduced.map((f) => f.rule)).toEqual(["lint.unused_variable"]);
  });
});
