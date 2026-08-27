import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VirtualRows } from "./VirtualRows";

/**
 * Windowing kicks in above the threshold and is skipped below it, because
 * virtualizing a short list costs more than it saves and breaks find-in-page.
 */
const meta: Meta<typeof VirtualRows<string>> = {
  title: "Run/Report/VirtualRows",
  component: VirtualRows<string>,
};
export default meta;

type Story = StoryObj<typeof VirtualRows<string>>;

const rows = (count: number) => Array.from({ length: count }, (_, i) => `row ${i}`);

const render = (item: string) => (
  <div key={item} className="border-t border-line py-1.5 font-mono text-xs">
    {item}
  </div>
);

/** Under the threshold: rendered whole. */
export const Short: Story = {
  args: { items: rows(10), children: render },
};

/** Over the threshold: windowed inside its own scroll container. */
export const Windowed: Story = {
  args: { items: rows(2000), children: render },
};

export const Empty: Story = {
  args: { items: [], children: render },
};
