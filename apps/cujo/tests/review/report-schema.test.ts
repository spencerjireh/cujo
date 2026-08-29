/**
 * The report schema, against the shapes `docs/contracts/report.example.json`
 * does not reach.
 *
 * The example is one `tests` report carrying two `sniff.py run` entries, so it
 * exercises neither the `detonate` half of the `runs[]` union nor any of the
 * places where the sandbox legitimately omits a key. Every case below is taken
 * from a line in `sandbox/`, not invented: if one of these starts failing, the
 * producer moved.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateReport } from "../../src/review/report-schema";

const EXAMPLE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../docs/contracts/report.example.json"), "utf8"),
);

/** The example's first run, which is a known-good `sniff.py run` entry. */
const runEntry = () => structuredClone(EXAMPLE.runs[0]);

/** A known-good envelope with one run in it. */
const report = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  check: "tests",
  runs: [runEntry()],
  derived: structuredClone(EXAMPLE.derived),
  sensors: structuredClone(EXAMPLE.sensors),
  truncated: structuredClone(EXAMPLE.truncated),
  ...over,
});

/**
 * `sniff.py detonate` (sandbox/cujo_sniff/detonate.py:71-86): the sensor block,
 * plus a dependency instead of a command. No `argv`, no `exit`.
 */
const detonateEntry = () => {
  const { argv: _argv, exit: _exit, ...sensors } = runEntry();
  return {
    ...sensors,
    dependency: "humanize==4.9.0",
    source: "pypi",
    install_ok: true,
  };
};

describe("the runs[] union", () => {
  it("accepts a detonate entry, which carries neither argv nor exit", () => {
    expect(validateReport(report({ check: "detonation", runs: [detonateEntry()] }))).toEqual({
      ok: true,
    });
  });

  it("accepts a report holding both kinds at once", () => {
    expect(validateReport(report({ runs: [runEntry(), detonateEntry()] }))).toEqual({ ok: true });
  });

  it("refuses an entry that is neither", () => {
    const { argv: _argv, exit: _exit, ...neither } = runEntry();
    expect(validateReport(report({ runs: [neither] })).ok).toBe(false);
  });
});

describe("what the sandbox is allowed to leave out", () => {
  it("accepts an egress row with no `known` verdict", () => {
    // merge_egress carries the flag through a merge rather than recomputing it:
    // "A row that never had one stays without one" (report.py:163-172).
    const run = runEntry();
    run.egress = run.egress.map(({ known: _known, ...rest }: { known?: boolean }) => rest);
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("accepts a roll-up that gives `armed` without the prose beside it", () => {
    // What the first production run actually sent. `sniff.py` writes both in
    // every runs[] entry; the envelope's block is the sub-agent's own roll-up,
    // and `armed` is the only half any rule reads.
    const rollup = {
      proxy: { armed: true },
      decoy: { armed: true },
      audit: { armed: true },
      fs_diff: { armed: true },
    };
    expect(validateReport(report({ sensors: rollup }))).toEqual({ ok: true });
    const run = runEntry();
    run.sensors = rollup;
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("still wants `armed` to be there and to be a boolean", () => {
    // The half that carries the meaning: a sensor that cannot say whether it
    // was watching is exactly what `sensor_unarmed` exists to surface.
    expect(validateReport(report({ sensors: { proxy: { detail: "port 8899" } } })).ok).toBe(false);
    expect(validateReport(report({ sensors: { proxy: { armed: "yes" } } })).ok).toBe(false);
  });

  it("accepts a sensors block missing a sensor entirely", () => {
    // merge_reports `continue`s past a sensor no report in the batch carried
    // (report.py:192-199), so a merged block can be short a key.
    const run = runEntry();
    const { audit: _audit, ...withoutAudit } = run.sensors;
    run.sensors = withoutAudit;
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("accepts a subprocess whose exit is null", () => {
    // detonate.py:80 emits `{"argv": ..., "exit": None}` for audit-hook rows.
    const run = runEntry();
    run.subprocesses = [{ argv: ["sh", "-c", "true"], exit: null }];
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("accepts a null decoy_in_egress, which is the only value there is", () => {
    // The proxy counts bytes and never reads a payload, so the sandbox emits
    // null rather than a false it never measured (decisions 20 and 54).
    const run = runEntry();
    run.secret_probe = { decoy_read: false, decoy_in_egress: null };
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("accepts an envelope with no sensors or truncated roll-up", () => {
    // A session pins its rubric at creation (decision 16), and the rubric names
    // `derived` but not these two. Requiring them would warn on every review
    // that was already in flight when this shipped.
    const { sensors: _s, truncated: _t, ...lean } = report();
    expect(validateReport(lean)).toEqual({ ok: true });
  });
});

describe("what it will not accept", () => {
  it("refuses a report with no runs at all", () => {
    const { runs: _runs, ...noRuns } = report();
    const result = validateReport(noRuns);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("runs");
  });

  it("refuses a derived block that is not booleans", () => {
    const result = validateReport(
      report({ derived: { ...EXAMPLE.derived, wrote_sensitive: "1" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("derived.wrote_sensitive");
  });

  it("names the path and never the value", () => {
    // Every string in a report is written by the code under review and is
    // escaped on the way out of the sandbox (Contract 2). A message quoting a
    // received value would be a second route for that text into a review body,
    // one that skipped the escaping.
    const run = runEntry();
    run.stdout_tail = { evil: "</script><!-- pwned -->" };
    const result = validateReport(report({ runs: [run] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).not.toContain("pwned");
  });
});

describe("schema_version", () => {
  it("accepts a version it has never heard of", () => {
    // Contract 2: "Read what you recognise; never reject a report for carrying
    // a version you do not know." The sandbox is always newer than the
    // container reading it (decision 54).
    expect(validateReport(report({ schema_version: 99 }))).toEqual({ ok: true });
  });

  it("accepts an envelope that carries no version at all", () => {
    // The rubric in force on every session created before this shipped does not
    // ask for one at the envelope, and a session keeps the rubric it was created
    // with (decision 16).
    const { schema_version: _v, ...noVersion } = report();
    expect(validateReport(noVersion)).toEqual({ ok: true });
  });

  it("still wants it to be a number when it is there", () => {
    expect(validateReport(report({ schema_version: "1" })).ok).toBe(false);
  });
});

describe("extras", () => {
  it("passes an unknown field through at every level", () => {
    // Decision 54 makes the report additive-only. A field this schema has never
    // heard of is a field from a newer sniff.py, not an error.
    const run = runEntry();
    run.something_new = { nested: true };
    run.egress[0].also_new = 1;
    expect(validateReport(report({ runs: [run], future_rollup: "hello" }))).toEqual({ ok: true });
  });
});
