import { boardMetrics } from "@/lib/board/metrics";
import { runs } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReadoutRack } from "./ReadoutRack";

const meta: Meta<typeof ReadoutRack> = {
  title: "Board/ReadoutRack",
  component: ReadoutRack,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ReadoutRack>;

export const Populated: Story = { args: { metrics: boardMetrics(runs) } };

/**
 * Every run still going, or folded before the timestamps existed. The rack has
 * to say it measured nothing rather than draw zeroes.
 */
export const NothingMeasured: Story = {
  args: {
    metrics: boardMetrics(runs.map((run) => ({ ...run, digest: null }))),
  },
};

/**
 * Nothing to summarise. The rack stays on screen disarmed — every panel's axis
 * drawn at the floor, each one saying what will fill it. An instrument with no
 * reading still shows its dial, and returning null here left a hole where the
 * whole middle of the page goes.
 */
export const Empty: Story = { args: { metrics: boardMetrics([]) } };

/**
 * One run, which is the shape a board has on its first day. The findings panel
 * and the activity strip both have to read as instruments rather than as a
 * single bar drawn large.
 */
export const OneRun: Story = { args: { metrics: boardMetrics(runs.slice(0, 1)) } };

/**
 * Every check reported and nothing was found. "Nothing found across n runs" is
 * a result, and has to read as one rather than as a panel that failed to load.
 */
export const NothingFound: Story = {
  args: {
    metrics: boardMetrics(
      runs.map((run) =>
        run.digest
          ? { ...run, digest: { ...run.digest, findings: { critical: 0, warn: 0, info: 0 } } }
          : run,
      ),
    ),
  },
};
