import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alarms, needsAttention, parseReport, unarmed } from "@/lib/api/report";
import { describe, expect, it } from "vitest";

/**
 * The renderer against the canonical example in `docs/contracts/`.
 *
 * `check.report` is `unknown` on both TypeScript sides, so nothing here is
 * checked by the compiler: a field renamed in `sandbox/` produces no error,
 * only an emptier table. The example file stands in for the schema, and the
 * three consumers each have a test that loads it —
 * `sandbox/tests/test_contract.py` for the producer,
 * `apps/cujo/tests/review/contract.report.test.ts` for the hard rules, and this
 * for the UI.
 */
const EXAMPLE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../../../docs/contracts/report.example.json"),
    "utf8",
  ),
);

/** The parsed blocks, or a failure here rather than an unreadable one below. */
function blocks(report: unknown) {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor") throw new Error(`expected a sensor block, got ${parsed.kind}`);
  return parsed.blocks;
}

/** One block by index, named so a shape change fails on the index and says so. */
function block(report: unknown, index: number) {
  const found = blocks(report)[index];
  if (!found) throw new Error(`no block at ${index}`);
  return found;
}

describe("the canonical report example", () => {
  it("is read as sensor data, not dumped as raw JSON", () => {
    // The failure this guards is silent: `looksLikeSensorBlock` keys on the
    // block names, so renaming or nesting one sends the whole forensic view to
    // the raw fallback with nothing going red.
    // The roll-up, plus one block per run.
    expect(blocks(EXAMPLE)).toHaveLength(1 + EXAMPLE.runs.length);
  });

  it("populates every field the example carries", () => {
    const run = block(EXAMPLE, 1);
    expect(run.egress[0]).toEqual({ host: "pypi.org", port: 443, bytes: 3200, known: true });
    expect(run.files_read[0]).toEqual({ path: "~/.aws/credentials", sensitive: true });
    expect(run.fs_changes[1]?.sensitive).toBe(true);
    expect(run.subprocesses[0]?.argv).toEqual(["sh", "-c", "curl -s collect.example"]);
    expect(run.secret_probe).toEqual({ decoy_read: true, decoy_in_egress: null });
    expect(run.sensors?.decoy).toEqual({ armed: true, detail: "inotify" });
    expect(run.truncated?.files_read).toBe(true);
    expect(run.truncated?.sensor_logs).toBe(false);
    expect(run.truncated?.script_content).toBe(false);
    expect(run.derived?.wrote_sensitive).toBe(true);
  });

  it("extracts command info from per-run blocks", () => {
    const run = block(EXAMPLE, 1);
    expect(run.command).toMatchObject({
      argv: ["python3", "-m", "pytest", "-q"],
      exit: 1,
      script_content: null,
    });
    expect(run.command?.duration_s).toBe(4.31);
  });

  it("does not extract command info from the roll-up block", () => {
    expect(block(EXAMPLE, 0).command).toBeNull();
  });

  it("keeps null apart from false on decoy_in_egress", () => {
    // Null is the report saying it could not know: the proxy counts bytes and
    // never reads a payload. Collapsing it to false would put back the claim
    // this contract removed.
    expect(block(EXAMPLE, 1).secret_probe?.decoy_in_egress).toBeNull();
    expect(parseReport({ secret_probe: { decoy_in_egress: false } })).toMatchObject({
      blocks: [{ secret_probe: { decoy_in_egress: false } }],
    });
    // Neither one lights the alarm; only a true would.
    expect(alarms(block(EXAMPLE, 1), "detonation").map((alarm) => alarm.text)).not.toContain(
      "decoy secret left the sandbox",
    );
  });

  it("opens the card for a sensor that was off, without raising a second chip", () => {
    const quiet = block(EXAMPLE, 2);
    // Nothing in this run tripped anything, and that is exactly when a reader
    // needs to know the watcher had stopped.
    expect(quiet.derived?.wrote_sensitive).toBe(false);
    expect(unarmed(quiet)).toEqual(["decoy"]);
    expect(needsAttention(quiet)).toBe(true);
    // Not an alarm chip, though. The roll-up is the pessimistic summary of the
    // runs, so this one blind interval is true of two of the three blocks; a
    // chip on each would count one gap twice. The health strip carries it, once
    // per card, and says which run it was.
    expect(alarms(quiet, "detonation")).toEqual([]);
    expect(unarmed(block(EXAMPLE, 0))).toEqual(["decoy"]);
    expect(unarmed(block(EXAMPLE, 1))).toEqual([]);
    // The audit hook being unarmed is ordinary for a check that runs no Python.
    expect(quiet.sensors?.audit?.armed).toBe(false);
    expect(unarmed(quiet)).not.toContain("audit");
  });

  it("says when a cap cut the output, which has no table to say it in", () => {
    // stdout_tail and stderr_tail are parsed here and rendered nowhere else, so
    // a flag with no home would be evidence-of-missing-evidence, dropped.
    const run = block(EXAMPLE, 1);
    expect(run.truncated).toMatchObject({ stdout_tail: false, stderr_tail: false });
    const cut = block({ egress: [], truncated: { stdout_tail: true } }, 0);
    expect(cut.truncated?.stdout_tail).toBe(true);
    expect(needsAttention(cut)).toBe(false);
  });

  it("treats an absent health block as unknown, not as off", () => {
    const bare = block({ egress: [] }, 0);
    expect(bare.sensors).toBeNull();
    expect(unarmed(bare)).toEqual([]);
    expect(alarms(bare, "detonation")).toEqual([]);
    expect(needsAttention(bare)).toBe(false);
  });
});
