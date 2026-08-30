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

  it("accepts a sensor_logs flag, which the schema used not to name", () => {
    // TRUNCATION_KEYS emits seven keys (report.py:34-42) and this schema named
    // six, so the flag rode on `.passthrough()` and was never typed.
    const run = runEntry();
    run.truncated = { ...run.truncated, sensor_logs: true };
    expect(validateReport(report({ runs: [run] }))).toEqual({ ok: true });
  });

  it("still wants sensor_logs to be a boolean when it is there", () => {
    const run = runEntry();
    run.truncated = { ...run.truncated, sensor_logs: "yes" };
    expect(validateReport(report({ runs: [run] })).ok).toBe(false);
  });
});

/**
 * The envelope's roll-up, which is the only block in a report a model writes
 * rather than copies. Every case here is a shape a production run actually
 * sent: three models produced three different partial readings of one rubric
 * sentence, and requiring the full shape warned on all of them (issue #101).
 */
describe("the envelope roll-up", () => {
  it("accepts an empty roll-up", () => {
    // Run bc0362c7 (orders-api#22): `truncated: {}` beside runs[] entries that
    // each carried all seven keys.
    expect(validateReport(report({ truncated: {}, derived: {} }))).toEqual({ ok: true });
  });

  it("accepts a roll-up short a key", () => {
    // `derived.spawned_subprocess: Required` and `truncated.stdout_tail:
    // Required`, the two most common of the fourteen.
    const { spawned_subprocess: _s, ...partialDerived } = EXAMPLE.derived;
    const { stdout_tail: _t, ...partialTruncated } = EXAMPLE.truncated;
    expect(
      validateReport(report({ derived: partialDerived, truncated: partialTruncated })),
    ).toEqual({ ok: true });
  });

  it("still refuses a roll-up value that is not a boolean", () => {
    // Lenient about which keys are there, never about what they say. A model
    // that reports `wrote_sensitive` as a string is not reporting it.
    const result = validateReport(report({ derived: { wrote_sensitive: "1" } }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("derived.wrote_sensitive");
  });

  it("still refuses a roll-up that is not an object", () => {
    // Run bc0362c7 again, on `smoke`: `truncated: Expected object, received
    // boolean`. A bare boolean is not a partial roll-up, it is a wrong one.
    expect(validateReport(report({ truncated: true })).ok).toBe(false);
  });

  it("still requires the envelope to carry derived at all", () => {
    const { derived: _derived, ...noDerived } = report();
    expect(validateReport(noDerived).ok).toBe(false);
  });

  it("does not extend the leniency to a runs[] entry", () => {
    // The point of the split. A runs[] block is copied verbatim from
    // `sniff.py`, so a key missing there means the producer moved — which is
    // the failure this file exists to catch.
    const withoutDerived = runEntry();
    const { spawned_subprocess: _s, ...shortDerived } = withoutDerived.derived;
    withoutDerived.derived = shortDerived;
    const derivedResult = validateReport(report({ runs: [withoutDerived] }));
    expect(derivedResult.ok).toBe(false);
    expect(derivedResult.ok === false && derivedResult.problem).toContain(
      "runs.0.derived.spawned_subprocess",
    );

    const withoutTruncated = runEntry();
    const { stdout_tail: _t, ...shortTruncated } = withoutTruncated.truncated;
    withoutTruncated.truncated = shortTruncated;
    expect(validateReport(report({ runs: [withoutTruncated] })).ok).toBe(false);
  });
});

/**
 * What the warn actually says, which is the whole value of raising one. A union
 * failure names no field on its own: `runs[]` is a union, and zod reports one
 * `invalid_union` whose message is "Invalid input" and whose path stops at the
 * entry. Every case here is a report production sent.
 */
describe("naming the field a runs[] entry got wrong", () => {
  /** Run 1fe11b28 (orders-api#19), `tests`: entries trimmed to the fields the
   * sub-agent thought mattered, which is the one thing the rubric forbids. */
  const trimmed = () => {
    const { files_read: _f, fs_changes: _c, ...rest } = runEntry();
    return rest;
  };

  it("names the missing field rather than the entry", () => {
    const result = validateReport(report({ runs: [trimmed()] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("runs.0.files_read");
    expect(result.ok === false && result.problem).not.toContain("Invalid input");
  });

  it("counts what it did not name", () => {
    // Six entries, two fields each: the reader has to be able to tell a
    // systemic trim from one slip, and the named field alone cannot.
    const result = validateReport(report({ runs: [trimmed(), trimmed(), trimmed()] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe("runs.0.files_read: Required (+5 more)");
  });

  it("says nothing about a count when there is one problem", () => {
    const result = validateReport(report({ schema_version: "1" }));
    expect(result.ok === false && result.problem).not.toContain("more)");
  });

  it("reads a detonate entry against the detonate branch", () => {
    // Run 1fe11b28 again, `detonation`: `fs_changes` was not an array. Read
    // against `CommandRun` the answer would be "no argv, no exit", which is
    // true of every detonate entry and tells a reader nothing.
    const entry = detonateEntry();
    entry.fs_changes = {};
    const result = validateReport(report({ check: "detonation", runs: [entry] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("runs.0.fs_changes");
    expect(result.ok === false && result.problem).not.toContain("argv");
  });

  it("names the path and never the value, through a union too", () => {
    // The same rule as the envelope case below, on the branch this walks into:
    // nothing in the schema is an enum or a literal, so a branch message is
    // `Required` or a pair of type names. Asserted, not assumed.
    const entry = runEntry();
    entry.stdout_tail = { evil: "</script><!-- pwned -->" };
    const result = validateReport(report({ runs: [entry] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("runs.0.stdout_tail");
    expect(result.ok === false && result.problem).not.toContain("pwned");
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
