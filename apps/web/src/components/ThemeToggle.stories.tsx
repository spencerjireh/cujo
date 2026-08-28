import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The three states match brand/tokens.css exactly: no attribute follows the
 * system, `light` and `dark` force one. Storybook's own theme control sets the
 * same attribute, so switching here and switching in the toolbar do the same
 * thing to the document.
 */
const meta: Meta<typeof ThemeToggle> = {
  title: "Primitives/ThemeToggle",
  component: ThemeToggle,
};
export default meta;

type Story = StoryObj<typeof ThemeToggle>;

export const Default: Story = {};

export const OnASurface: Story = {
  render: () => (
    <div className="flex items-center justify-between rounded-md border border-line bg-bg-raised p-4">
      <span className="text-sm text-fg-muted">Header placement</span>
      <ThemeToggle />
    </div>
  ),
};
