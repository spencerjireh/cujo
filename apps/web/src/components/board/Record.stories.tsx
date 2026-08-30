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
 * length rather than turning into texture — and that the field stops at its
 * ceiling of twelve and a half rows, scrolls inside itself, and keeps the
 * column header pinned while it does (decision 74).
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
 * a young record should look young, not cramped. Same band as `Empty` and
 * `Many`: the record is one field of a fixed length.
 */
export const Sparse: Story = { args: { runs: runs.slice(0, 2) } };

/**
 * No runs at all. The column header and the ruled rhythm stay, so this is the
 * record holding nothing rather than a message where the record was, and the
 * copy says what to do next — an empty screen is an invitation to act and not a
 * sentence in muted grey.
 *
 * The other empty record, the one a filter produced, is not a story: the filter
 * is this component's own state, so it is reached by clicking `Live` or
 * `Awaiting approval` on `Empty` or on `OnlyLive`.
 */
export const Empty: Story = { args: { runs: [] } };
