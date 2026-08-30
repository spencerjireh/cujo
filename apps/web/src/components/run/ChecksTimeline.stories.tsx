import { cleanChecks, detonationChecks, findings, run, runningChecks } from "@/lib/fixtures";
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

/**
 * The sandbox tripped and the fold has not turned it into a finding yet, which
 * is what a live detonation looks like for the seconds between the two. The
 * lane says what the sensor saw rather than "ok".
 */
export const SensorAlarmOnly: Story = {
  args: { checks: detonationChecks, findings: [] },
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

/**
 * The whole envelope (decision 67). Setup dwarfs the checks, which is the
 * shape decision 67 measured and the reason it is drawn: a run does seconds of
 * execution inside minutes of wall clock, and every story above this one shows
 * only the seconds.
 */
export const WithSetup: Story = {
  args: { checks: detonationChecks, findings, setup: run().setup },
};

/**
 * A second run on the same pull request. `sandbox.created` is session-scoped,
 * so there is no provisioning to draw at the head of the lane — and the lane is
 * shorter, which is the whole reason a re-run is faster.
 */
export const SetupOnRerun: Story = {
  args: {
    checks: detonationChecks,
    findings,
    setup: {
      turnCreatedAt: "2026-08-28T09:59:30.000Z",
      sandboxCreatedAt: null,
      agentStartedAt: "2026-08-28T09:59:34.000Z",
      firstCheckAt: "2026-08-28T10:00:02.000Z",
      messages: 3,
      ms: 28_000,
    },
  },
};
