import { cleanChecks, detonationChecks, findings, runningChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChecksTimeline } from "./ChecksTimeline";

const meta: Meta<typeof ChecksTimeline> = {
  title: "Run/ChecksTimeline",
  component: ChecksTimeline,
};
export default meta;

type Story = StoryObj<typeof ChecksTimeline>;

/** The demo's centrepiece: detonation runs longest and is the one that trips. */
export const Detonation: Story = {
  args: { checks: detonationChecks, findings },
};

export const AllClean: Story = {
  args: { checks: cleanChecks, findings: [] },
};

/** Mid-run: two lanes still filling, one already finished. */
export const StillRunning: Story = {
  args: { checks: runningChecks, findings: [] },
};

/** A check that errored rather than reporting. */
export const CheckErrored: Story = {
  args: {
    checks: cleanChecks.map((check) =>
      check.title === "smoke"
        ? { ...check, status: "error" as const, error: "sandbox exited during boot" }
        : check,
    ),
    findings: [],
  },
};

/**
 * A run recorded before apps/cujo stamped thread timestamps. The lanes have no
 * geometry to draw, so they fall back to a flat state bar.
 */
export const WithoutTimestamps: Story = {
  args: {
    checks: cleanChecks.map((check) => ({ ...check, startedAt: null, endedAt: null })),
    findings: [],
  },
};

/** Nothing started yet. */
export const NoChecks: Story = {
  args: { checks: [], findings: [] },
};
