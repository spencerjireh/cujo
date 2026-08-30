import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Legend } from "./Legend";

const meta: Meta<typeof Legend> = {
  title: "Board/Legend",
  component: Legend,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Legend>;

/**
 * The key takes no props: every list in it comes from `RUN_STATUSES`,
 * `SEVERITIES` and the tone maps, so a status added in `apps/cujo` appears here
 * without anybody remembering to add it.
 *
 * The one thing to check by eye is the theme: the diagram keeps the chamber's
 * pinned dark palette in both, and the legends beside it swap with the page.
 */
export const Default: Story = {};
