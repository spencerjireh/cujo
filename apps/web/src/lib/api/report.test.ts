import { describe, expect, it } from "vitest";
import { alarms, parseReport } from "./report";

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
        { dependency: "evil-package==1.0.0", egress: [{ host: "185.220.101.4", known: false }] },
      ],
    });
    expect(parsed.kind).toBe("sensor");
    if (parsed.kind !== "sensor") return;
    expect(parsed.blocks.map((block) => block.label)).toEqual([
      "humanize==4.9.0",
      "evil-package==1.0.0",
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
    expect(alarms(parsed.blocks[0])).toEqual([
      "decoy secret left the sandbox",
      "decoy secret was read",
      "egress to an unknown host",
      "wrote to a sensitive path",
    ]);
  });

  it("says nothing when nothing tripped", () => {
    const parsed = parseReport({ egress: [], derived: { egress_to_unknown_host: false } });
    if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
    expect(alarms(parsed.blocks[0])).toEqual([]);
  });
});
