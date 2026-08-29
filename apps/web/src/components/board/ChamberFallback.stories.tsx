import { specimensFrom } from "@/lib/board/specimen";
import { runs } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChamberFallback } from "./ChamberFallback";

/**
 * The flat elevation. It is what the server renders, what a browser with no
 * WebGL keeps, and what a narrow viewport gets instead of the scene — so it is
 * worth looking at on its own rather than only as a thing behind a canvas.
 */
const meta: Meta<typeof ChamberFallback> = {
  title: "Board/ChamberFallback",
  component: ChamberFallback,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[26rem] w-full bg-[var(--chamber)] p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ChamberFallback>;

export const Horizontal: Story = { args: { specimens: specimensFrom(runs, 24) } };

export const Vertical: Story = {
  args: { specimens: specimensFrom(runs, 14), orientation: "vertical" },
  decorators: [
    (Story) => (
      <div className="h-[34rem] w-28 bg-[var(--chamber)]">
        <Story />
      </div>
    ),
  ],
};

/** A record where nothing folded: cores, no arms, and the gap is the fact. */
export const NothingFolded: Story = {
  args: {
    specimens: specimensFrom(
      runs.map((run) => ({ ...run, digest: null })),
      24,
    ),
  },
};

export const Empty: Story = { args: { specimens: [] } };
