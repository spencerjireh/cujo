import { alarms, parseReport } from "@/lib/api/report";
import { describe, expect, it } from "vitest";

/**
 * The parser's contract is that it never throws, whatever apps/cujo pulled out
 * of a subagent's message. Everything it cannot recognise has to reach the raw
 * view rather than blanking the page.
 */
describe("parseReport", () => {
  it("treats a missing report as empty", () => {
    expect(parseReport(null)).toEqual({ kind: "empty" });
    expect(parseReport(undefined)).toEqual({ kind: "empty" });
  });

  it("passes non-objects through as opaque", () => {
    expect(parseReport("nope")).toEqual({ kind: "opaque", raw: "nope" });
    expect(parseReport(42)).toEqual({ kind: "opaque", raw: 42 });
    expect(parseReport([1, 2])).toEqual({ kind: "opaque", raw: [1, 2] });
  });

  it("treats an object with no sensor keys as opaque", () => {
    const raw = { summary: "all good" };
    expect(parseReport(raw)).toEqual({ kind: "opaque", raw });
  });

  it("reads a bare sensor block", () => {
    const parsed = parseReport({
      egress: [{ host: "pypi.org", port: 443, bytes: 3200, known: true }],
      files_read: [{ path: "~/.aws/credentials", sensitive: true }],
      secret_probe: { decoy_read: false, decoy_in_egress: false },
      derived: { egress_to_unknown_host: false },
    });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.egress[0]?.host).toBe("pypi.org");
    expect(parsed.blocks[0]?.files_read[0]?.sensitive).toBe(true);
  });

  it("flattens the runs[] nesting a detonation report uses", () => {
    const parsed = parseReport({
      runs: [
        { dependency: "humanize==4.9.0", egress: [{ host: "pypi.org" }] },
        { dependency: "tainted-sample==1.0.0", egress: [{ host: "185.220.101.4", known: false }] },
      ],
    });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    expect(parsed.blocks.map((block) => block.label)).toEqual([
      "humanize==4.9.0",
      "tainted-sample==1.0.0",
    ]);
  });

  it("keeps a top-level block and its nested runs together", () => {
    const parsed = parseReport({
      egress: [{ host: "a.example" }],
      runs: [{ egress: [{ host: "b.example" }] }],
    });
    expect(parsed.kind === "sensor" && parsed.blocks).toHaveLength(2);
  });

  it("drops malformed entries instead of rendering them", () => {
    const parsed = parseReport({
      egress: [{ host: "ok.example" }, { port: 443 }, "garbage", null],
      fs_changes: [{ path: "/tmp/x", type: "created" }, {}],
      subprocesses: [{ argv: ["pip", "install"] }, { argv: "not-an-array" }],
    });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    expect(parsed.blocks[0]?.egress).toHaveLength(1);
    expect(parsed.blocks[0]?.fs_changes).toHaveLength(1);
    expect(parsed.blocks[0]?.subprocesses).toHaveLength(1);
  });

  it("extracts script_content from a run block", () => {
    const parsed = parseReport({
      runs: [
        {
          argv: ["python3", "probe.py"],
          exit: 0,
          duration_s: 1.2,
          stdout_tail: "ok",
          stderr_tail: "",
          script_content: "print('hello')",
          egress: [],
          truncated: { script_content: false, sensor_logs: false },
        },
      ],
    });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    const run = parsed.blocks[0];
    expect(run?.command?.script_content).toBe("print('hello')");
    expect(run?.command?.argv).toEqual(["python3", "probe.py"]);
    expect(run?.truncated?.script_content).toBe(false);
    expect(run?.truncated?.sensor_logs).toBe(false);
  });

  it("sets command to null when argv is absent", () => {
    const parsed = parseReport({ egress: [{ host: "a.example" }] });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    expect(parsed.blocks[0]?.command).toBeNull();
  });

  it("parses truncated sensor_logs and script_content flags", () => {
    const parsed = parseReport({
      egress: [],
      truncated: { stdout_tail: false, sensor_logs: true, script_content: true },
    });
    if (parsed.kind !== "sensor") throw new Error("expected sensor");
    expect(parsed.blocks[0]?.truncated?.sensor_logs).toBe(true);
    expect(parsed.blocks[0]?.truncated?.script_content).toBe(true);
  });

  it("survives a deeply nested and circular-free garbage shape", () => {
    expect(() => parseReport({ runs: [null, 3, "x", { egress: "no" }] })).not.toThrow();
  });
});

describe("alarms", () => {
  it("names every tripped flag, worst first", () => {
    const parsed = parseReport({
      secret_probe: { decoy_read: true, decoy_in_egress: true },
      derived: { egress_to_unknown_host: true, wrote_sensitive: true },
    });
    if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
    expect(alarms(parsed.blocks[0], "detonation").map((alarm) => alarm.text)).toEqual([
      "decoy secret left the sandbox",
      "decoy secret was read",
      "egress to an unknown host",
      "wrote to a sensitive path",
    ]);
  });

  it("takes each flag's severity from whether a hard rule reads it", () => {
    // The four hard rules in `apps/cujo/src/review/findings.ts` are all
    // critical there. `wrote_outside_workspace` is read by no rule at all — a
    // build that writes to /tmp is ordinary — so it is the one that is not.
    const parsed = parseReport({
      derived: { wrote_sensitive: true, wrote_outside_workspace: true },
    });
    if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
    expect(alarms(parsed.blocks[0], "tests")).toEqual([
      { text: "wrote to a sensitive path", severity: "critical" },
      { text: "wrote outside the workspace", severity: "warn" },
    ]);
  });

  it("charges unknown egress as critical only on detonation", () => {
    // `docs/spec.md`: the rule is scoped to the install. A test suite that
    // reached a host the allowlist does not name is worth a look, not a charge.
    const parsed = parseReport({ derived: { egress_to_unknown_host: true } });
    if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
    expect(alarms(parsed.blocks[0], "detonation")).toEqual([
      { text: "egress to an unknown host", severity: "critical" },
    ]);
    expect(alarms(parsed.blocks[0], "tests")).toEqual([
      { text: "egress to an unknown host", severity: "warn" },
    ]);
  });

  it("says nothing when nothing tripped", () => {
    const parsed = parseReport({ egress: [], derived: { egress_to_unknown_host: false } });
    if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
    expect(alarms(parsed.blocks[0], "detonation")).toEqual([]);
  });
});
