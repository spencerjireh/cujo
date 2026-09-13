import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VerdictCard } from "./VerdictCard";

const meta: Meta<typeof VerdictCard> = {
  title: "Run/VerdictCard",
  component: VerdictCard,
};
export default meta;

type Story = StoryObj<typeof VerdictCard>;

/** The block: two hard rules tripped and the merge is held. */
export const Blocked: Story = { args: { run: run() } };

/** Nothing found, and "0 critical" says so rather than an empty row. */
export const Clean: Story = {
  args: { run: run({ status: "clean", findings: [], hard_rule_hits: [] }) },
};

/** Live: the counts are not a result yet, so the card says so instead. */
export const Running: Story = {
  args: { run: run({ status: "running", review: null }) },
};

/** A maintainer lifted the block: the findings stand, the merge does not wait. */
export const Dismissed: Story = {
  args: { run: run({ status: "dismissed" }) },
};
