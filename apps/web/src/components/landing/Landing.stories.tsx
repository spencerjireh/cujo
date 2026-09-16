import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Landing } from "./Landing";

const meta = {
  title: "Landing/Landing",
  component: Landing,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="pt-10">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof Landing>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What anyone arriving from a link or a search sees. */
export const Visitor: Story = { args: { reader: "visitor" } };

/** The same page for a signed-in owner: their pages first, the manual kept. */
export const Owner: Story = { args: { reader: "owner" } };
