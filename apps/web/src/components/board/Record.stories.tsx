import { runs } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Record } from "./Record";

const meta: Meta<typeof Record> = {
  title: "Board/Record",
  component: Record,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Record>;

export const Populated: Story = { args: { runs } };

/** Only the runs a turn can still change, which is what the filter selects. */
export const OnlyLive: Story = {
  args: {
    runs: runs.filter((run) => run.status === "running" || run.status === "blocked_pending"),
  },
};

/**
 * Sixty rows, to check the sensor strip and the duration column still scan at
 * length rather than turning into texture.
 */
export const Many: Story = {
  args: {
    runs: Array.from({ length: 60 }, (_, i) => {
      const base = runs[i % runs.length];
      if (!base) throw new Error("fixtures are empty");
      return { ...base, id: `run-many-${i}`, pr_number: 100 + i };
    }),
  },
};

/**
 * Two runs, which is what a board looks like on its first day. The table keeps
 * its rhythm with empty rows rather than sitting hard against what follows it —
 * a young record should look young, not cramped.
 */
export const Sparse: Story = { args: { runs: runs.slice(0, 2) } };

/**
 * No runs at all. The block has height and says what to do next, because an
 * empty screen is an invitation to act and not a sentence in muted grey.
 */
export const Empty: Story = { args: { runs: [] } };
