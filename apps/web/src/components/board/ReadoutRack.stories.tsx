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

/** Nothing to summarise: the rack renders nothing at all rather than an axis. */
export const Empty: Story = { args: { metrics: boardMetrics([]) } };
