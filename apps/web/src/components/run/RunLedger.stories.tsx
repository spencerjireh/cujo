import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RunLedger } from "./RunLedger";

const meta: Meta<typeof RunLedger> = {
  title: "Run/RunLedger",
  component: RunLedger,
};
export default meta;

type Story = StoryObj<typeof RunLedger>;

export const Populated: Story = { args: { usage: run().usage } };

/**
 * No cost estimate from the provider. The bar and the counts still stand; only
 * the dollar figure is absent, because Cujo prices nothing itself and must not
 * look as though it did.
 */
export const NoEstimate: Story = {
  args: {
    usage: {
      inputTokens: 12_400,
      outputTokens: 2_050,
      cacheReadTokens: 88_000,
      cacheWriteTokens: 4_100,
      messages: 14,
    },
  },
};

/**
 * A run recorded before the field existed. It renders nothing — not four empty
 * bars, which would say the run cost nothing when what is true is that there is
 * no record of what it cost (decision 54).
 */
export const NoRecord: Story = { args: { usage: null } };

/**
 * A diff run, which carries a budget (decision 132). The bar is drawn against
 * it and the unspent remainder is track, so the reader sees the spend as a
 * share of what the turn was allowed rather than as a bar that is always full.
 */
export const WithBudget: Story = {
  args: {
    usage: {
      inputTokens: 96_000,
      outputTokens: 3_200,
      cacheReadTokens: 41_000,
      cacheWriteTokens: 8_000,
      messages: 4,
    },
    budget: 400_000,
  },
};
