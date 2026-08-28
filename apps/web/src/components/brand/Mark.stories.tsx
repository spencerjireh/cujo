import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Mark } from "./Mark";

const meta: Meta<typeof Mark> = {
  title: "Brand/Mark",
  component: Mark,
};
export default meta;

type Story = StoryObj<typeof Mark>;

export const Default: Story = { args: { className: "h-16 w-16" } };

/** The mark takes the text colour, so it works on any surface in either theme. */
export const InheritsColour: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Mark className="h-10 w-10 text-fg" />
      <Mark className="h-10 w-10 text-accent" />
      <Mark className="h-10 w-10 text-sev-critical" />
    </div>
  ),
};

/** brand/brand.md sets a 16 px floor. Below 24 px the favicon cut is used instead. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      {[16, 24, 32, 64, 128].map((size) => (
        <div key={size} className="text-center">
          <Mark className="mx-auto text-fg" style={{ width: size, height: size }} />
          <span className="mt-1 block font-mono text-xs text-fg-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
};
