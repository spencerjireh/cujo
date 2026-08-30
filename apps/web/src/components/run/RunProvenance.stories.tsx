import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RunProvenance } from "./RunProvenance";

const meta: Meta<typeof RunProvenance> = {
  title: "Run/RunProvenance",
  component: RunProvenance,
};
export default meta;

type Story = StoryObj<typeof RunProvenance>;

/** Everything the board publishes about what produced the verdict. */
export const Full: Story = {
  args: { run: run() },
};

/** A re-run: the sandbox was already there, so no `sandbox.created` stamp. */
export const Rerun: Story = {
  args: {
    run: run({
      setup: {
        turnCreatedAt: "2026-08-28T09:59:30.000Z",
        sandboxCreatedAt: null,
        agentStartedAt: "2026-08-28T09:59:34.000Z",
        firstCheckAt: "2026-08-28T10:00:02.000Z",
        messages: 3,
        ms: 28_000,
      },
    }),
  },
};

/**
 * A run recorded before any of this was stored. The section renders nothing at
 * all rather than a disclosure that opens onto an empty list.
 */
export const NothingRecorded: Story = {
  args: {
    run: run({
      session_id: undefined,
      turn_ids: undefined,
      delivery_id: null,
      model: null,
      rubric_sha256: null,
      setup: null,
    }),
  },
};
