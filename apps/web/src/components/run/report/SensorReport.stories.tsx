import { type SensorBlock, parseReport } from "@/lib/api/report";
import { detonationChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SensorReport } from "./SensorReport";

function blockFrom(report: unknown): SensorBlock {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
  return parsed.blocks[0];
}

function blocksFrom(report: unknown): SensorBlock[] {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor") throw new Error("expected sensor blocks");
  return parsed.blocks;
}

/** The one `runs[]` entry of a fixture report, so a story can add to it. */
function firstRun(report: unknown): Record<string, unknown> {
  const first = (report as { runs?: unknown[] } | null)?.runs?.[0];
  if (!first || typeof first !== "object") throw new Error("expected a run block");
  return first as Record<string, unknown>;
}

/** The health block a sandbox writes when every sensor came up. */
const ALL_WATCHING = {
  proxy: { armed: true, detail: "port 8899" },
  decoy: { armed: true, detail: "inotify" },
  audit: { armed: true, detail: "9214 rows" },
  fs_diff: { armed: true, detail: "3184 paths" },
};

const meta: Meta<typeof SensorReport> = {
  title: "Run/Report/SensorReport",
  component: SensorReport,
};
export default meta;

type Story = StoryObj<typeof SensorReport>;

/** The hostile dependency: every alarm lit, and every sensor up to see it. */
export const Exfiltration: Story = {
  args: {
    block: blockFrom({
      ...firstRun(detonationChecks[3]?.report),
      sensors: ALL_WATCHING,
    }),
  },
};

/**
 * A normal install. Nothing tripped, so the coverage line is the card's whole
 * verdict — without it this block was a dependency name and two short tables,
 * and the reader had to infer that meant clean.
 */
export const Clean: Story = {
  args: {
    block: blockFrom({
      dependency: "humanize==4.9.0",
      egress: [{ host: "pypi.org", port: 443, bytes: 11_000, known: true }],
      files_read: [],
      fs_changes: [{ path: "site-packages/humanize", type: "created", in_workspace: true }],
      subprocesses: [{ argv: ["pip", "install", "humanize==4.9.0"], exit: 0 }],
      secret_probe: { decoy_read: false, decoy_in_egress: false },
      sensors: ALL_WATCHING,
      derived: { egress_to_unknown_host: false, wrote_sensitive: false },
    }),
  },
};

/** The proxy refused the connection. A row with no bytes is not a quiet row. */
export const Refused: Story = {
  args: {
    block: blockFrom({
      dependency: "tainted-sample==1.0.0",
      egress: [
        { host: "185.220.101.4", port: 443, bytes: 0, known: false, errors: 3 },
        { host: "pypi.org", port: 443, bytes: 11_000, known: true },
      ],
      sensors: ALL_WATCHING,
      derived: { egress_to_unknown_host: true },
    }),
  },
};

/**
 * A block whose optional fields are all absent, and which never said whether
 * anything was watching. Nothing may render as blank rows, and no table may
 * claim `none`: this report supports neither answer.
 */
export const Sparse: Story = {
  args: { block: blockFrom({ derived: { egress_to_unknown_host: false } }) },
};

/** Long enough to be windowed. The header row sits above the scroller. */
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
 * Nothing tripped, and one sensor was not watching. The point of the coverage
 * line: the tables below are empty for a reason that has nothing to do with the
 * code, and egress says so rather than showing zero rows.
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

/**
 * The real shape of a detonation report: a roll-up and one block per
 * dependency, which used to stack with nothing between them but a small mono
 * line. Rendered here as the card renders them.
 */
export const SeveralBlocks: Story = {
  render: () => {
    const blocks = blocksFrom({
      egress: [{ host: "pypi.org", port: 443, bytes: 22_000, known: true }],
      subprocesses: [{ argv: ["pip", "install", "-r", "requirements.txt"], exit: 0 }],
      sensors: ALL_WATCHING,
      derived: { egress_to_unknown_host: false },
      runs: [
        {
          dependency: "humanize==4.9.0",
          egress: [{ host: "pypi.org", port: 443, bytes: 11_000, known: true }],
          sensors: ALL_WATCHING,
          derived: { egress_to_unknown_host: false },
        },
        {
          dependency: "tainted-sample==1.0.0",
          egress: [{ host: "185.220.101.4", port: 443, bytes: 3200, known: false }],
          files_read: [{ path: "~/.aws/credentials", sensitive: true }],
          fs_changes: [{ path: "/tmp/.x", type: "created", in_workspace: false }],
          sensors: ALL_WATCHING,
          secret_probe: { decoy_read: true, decoy_in_egress: null },
          derived: { egress_to_unknown_host: true, wrote_outside_workspace: true },
        },
      ],
    });
    return (
      <div>
        {blocks.map((block, index) => (
          <SensorReport
            key={block.label ?? `block-${index}`}
            block={block}
            index={index}
            total={blocks.length}
          />
        ))}
      </div>
    );
  },
};
