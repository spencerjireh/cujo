import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VerdictCard } from "./VerdictCard";

const meta: Meta<typeof VerdictCard> = {
  title: "Run/VerdictCard",
  component: VerdictCard,
};
export default meta;

type Story = StoryObj<typeof VerdictCard>;

/** The accusation held: the run waits on a person. */
export const AwaitingApproval: Story = { args: { run: run() } };

/** Nothing found, and "0 critical" says so rather than an empty row. */
export const Clean: Story = {
  args: { run: run({ status: "clean", findings: [], hard_rule_hits: [] }) },
};

/** Live: the counts are not a result yet, so the card says so instead. */
export const Running: Story = {
  args: { run: run({ status: "running", review: null, gated_review: null }) },
};

/** Ended with nothing posted: the run is over and did not block. */
export const Denied: Story = {
  args: { run: run({ status: "denied", review: null, gated_review: null }) },
};
