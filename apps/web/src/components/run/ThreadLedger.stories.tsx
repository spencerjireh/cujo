import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ThreadLedger } from "./ThreadLedger";

const meta: Meta<typeof ThreadLedger> = {
  title: "Run/ThreadLedger",
  component: ThreadLedger,
};
export default meta;

type Story = StoryObj<typeof ThreadLedger>;

export const Populated: Story = { args: { ledger: run().ledger } };

/** A diff run: one thread, no sub-agents, and a brief that was read once. */
export const ParentOnly: Story = {
  args: {
    ledger: {
      threads: [
        {
          title: "main",
          attempt: 1,
          messages: 3,
          inputTokens: 24_300,
          outputTokens: 600,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 380,
          toolResultBytes: 1_024,
        },
      ],
      largestToolResults: [
        { thread: "main", tool: "post_advisory_review", bytes: 1_024, isError: false },
      ],
    },
  },
};

/** A check the rubric respawned: the same title twice, numbered. */
export const RetriedCheck: Story = {
  args: {
    ledger: {
      threads: [
        {
          title: "main",
          attempt: 1,
          messages: 9,
          inputTokens: 8_000,
          outputTokens: 1_200,
          cacheReadTokens: 40_000,
          cacheWriteTokens: 0,
          reasoningTokens: null,
          toolResultBytes: 20_480,
        },
        {
          title: "detonation",
          attempt: 1,
          messages: 4,
          inputTokens: 131_966,
          outputTokens: 2_080,
          cacheReadTokens: 73_984,
          cacheWriteTokens: 0,
          reasoningTokens: null,
          toolResultBytes: 40_960,
        },
        {
          title: "detonation",
          attempt: 2,
          messages: 6,
          inputTokens: 217_020,
          outputTokens: 26_884,
          cacheReadTokens: 72_960,
          cacheWriteTokens: 0,
          reasoningTokens: null,
          toolResultBytes: 92_160,
        },
      ],
      largestToolResults: [
        { thread: "detonation", tool: "sandbox_exec", bytes: 65_536, isError: true },
        { thread: "detonation", tool: "sandbox_exec", bytes: 30_720, isError: false },
      ],
    },
  },
};

/** A run recorded before the ledger existed renders nothing at all. */
export const NoRecord: Story = { args: { ledger: null } };
