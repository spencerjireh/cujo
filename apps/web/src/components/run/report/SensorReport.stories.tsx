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
