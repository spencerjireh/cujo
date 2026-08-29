import { Mark } from "@/components/brand/Mark";
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

/**
 * Where the one-amber-eye rule is judged: the mark's eye on the left, the
 * selected glyph on the right, and nothing amber in between.
 */
export const InTheHeader: Story = {
  render: () => (
    <header className="flex items-center justify-between gap-4 border-b border-line py-4">
      <span className="flex items-center gap-2.5 text-fg">
        <Mark className="h-7 w-7" />
        <span className="font-display text-xl font-bold lowercase tracking-tight">cujo</span>
      </span>
      <ThemeToggle />
    </header>
  ),
};
