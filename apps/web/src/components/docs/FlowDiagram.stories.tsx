import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FlowDiagram } from "./FlowDiagram";

/**
 * The one drawing in the manual, and the one thing here worth a story: every
 * colour in it is a token off the document, so the check that matters is that
 * it still reads when the page goes the other way.
 */
const meta: Meta<typeof FlowDiagram> = {
  title: "Docs/FlowDiagram",
  component: FlowDiagram,
};
export default meta;

type Story = StoryObj<typeof FlowDiagram>;

export const Default: Story = {};

/** Narrow enough to force the diagram's own horizontal scroll. */
export const Narrow: Story = {
  render: () => (
    <div className="max-w-sm">
      <FlowDiagram />
    </div>
  ),
};
