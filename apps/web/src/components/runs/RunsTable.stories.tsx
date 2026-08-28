import { runs, summary } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RunsTable } from "./RunsTable";

const meta: Meta<typeof RunsTable> = {
  title: "Runs/RunsTable",
  component: RunsTable,
};
export default meta;

type Story = StoryObj<typeof RunsTable>;

/** Every status represented, sortable by any column. */
export const Populated: Story = { args: { runs } };

/** First run of a fresh install: the empty state has to say what to do next. */
export const Empty: Story = { args: { runs: [] } };

export const OnlyLive: Story = {
  args: { runs: runs.filter((run) => run.status === "running") },
};

/** Enough rows to check the header, spacing, and hover behaviour hold up. */
export const Many: Story = {
  args: {
    runs: Array.from({ length: 60 }, (_, i) => ({
      ...(runs[i % runs.length] ?? summary),
      id: `run-${i}`,
      pr_number: 100 - i,
    })),
  },
};
