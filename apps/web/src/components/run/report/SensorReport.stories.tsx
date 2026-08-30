import { type SensorBlock, parseReport } from "@/lib/api/report";
import { detonationChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SensorReport } from "./SensorReport";

function blockFrom(report: unknown): SensorBlock {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
  return parsed.blocks[0];
}

const meta: Meta<typeof SensorReport> = {
  title: "Run/Report/SensorReport",
  component: SensorReport,
};
export default meta;

type Story = StoryObj<typeof SensorReport>;

/** The hostile dependency: every alarm lit. */
export const Exfiltration: Story = {
  args: { block: blockFrom(detonationChecks[3]?.report) },
};

/** A normal install: package index only, nothing flagged. */
export const Clean: Story = {
  args: {
    block: blockFrom({
      dependency: "humanize==4.9.0",
      egress: [{ host: "pypi.org", port: 443, bytes: 11_000, known: true }],
      files_read: [],
      fs_changes: [{ path: "site-packages/humanize", type: "created", in_workspace: true }],
      subprocesses: [{ argv: ["pip", "install", "humanize==4.9.0"], exit: 0 }],
      secret_probe: { decoy_read: false, decoy_in_egress: false },
      derived: { egress_to_unknown_host: false, wrote_sensitive: false },
    }),
  },
};

/** A block whose optional fields are all absent. Nothing may render as blank rows. */
export const Sparse: Story = {
  args: { block: blockFrom({ derived: { egress_to_unknown_host: false } }) },
};

/** Long enough to be windowed. */
export const Windowed: Story = {
  args: {
    block: blockFrom({
      egress: Array.from({ length: 800 }, (_, i) => ({
        host: `host-${i}.example`,
        port: 443,
        bytes: i * 31,
        known: i % 11 !== 0,
      })),
    }),
  },
};

/**
 * Nothing tripped, and one sensor was not watching. The point of the strip: the
 * tables below are empty for a reason that has nothing to do with the code.
 */
export const SensorDown: Story = {
  args: {
    block: blockFrom({
      egress: [],
      files_read: [],
      fs_changes: [],
      subprocesses: [],
      secret_probe: { decoy_read: false, decoy_in_egress: null },
      sensors: {
        proxy: { armed: false, detail: "started during setup, no longer running" },
        decoy: { armed: true, detail: "inotify" },
        audit: { armed: false, detail: "no Python process ran" },
        fs_diff: { armed: true, detail: "3184 paths" },
      },
      truncated: { stdout_tail: false, stderr_tail: false, files_read: false, snapshot: false },
      derived: {
        egress_to_unknown_host: false,
        wrote_outside_workspace: false,
        wrote_sensitive: false,
        spawned_subprocess: false,
      },
    }),
  },
};

/** A cap cut the evidence. An empty group still renders, so as to say so. */
export const Truncated: Story = {
  args: {
    block: blockFrom({
      files_read: [{ path: "~/work/head/app.py", sensitive: false }],
      fs_changes: [],
      sensors: {
        proxy: { armed: true, detail: "port 8899" },
        decoy: { armed: true, detail: "atime" },
        audit: { armed: true, detail: "9214 rows" },
        fs_diff: { armed: true, detail: "200000 paths (capped)" },
      },
      truncated: { stdout_tail: true, stderr_tail: false, files_read: true, snapshot: true },
    }),
  },
};

/** A per-run block with a captured probe script. */
export const WithScript: Story = {
  args: {
    block: blockFrom({
      argv: ["python3", "probe_secrets.py"],
      exit: 0,
      duration_s: 0.42,
      stdout_tail: "PASS",
      stderr_tail: "",
      script_content: [
        "import os, pathlib",
        "",
        'cred = pathlib.Path.home() / ".aws" / "credentials"',
        "if cred.exists():",
        '    print("FAIL: credential file present")',
        "else:",
        '    print("PASS")',
      ].join("\n"),
      egress: [],
      files_read: [{ path: "~/.aws/credentials", sensitive: true }],
      fs_changes: [],
      subprocesses: [],
      secret_probe: { decoy_read: false, decoy_in_egress: null },
      sensors: {
        proxy: { armed: true, detail: "port 8899" },
        decoy: { armed: true, detail: "inotify" },
        audit: { armed: true, detail: "42 rows" },
        fs_diff: { armed: true, detail: "3184 paths" },
      },
      truncated: {
        stdout_tail: false,
        stderr_tail: false,
        files_read: false,
        snapshot: false,
        sensor_logs: false,
        script_content: false,
      },
      derived: { egress_to_unknown_host: false },
    }),
  },
};
