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

/** What anyone arriving from a link or a search sees. An owner is sent to /activity. */
export const Visitor: Story = {};

/** Back from a sign-in that took longer than ten minutes. */
export const SignInExpired: Story = { args: { signin: "expired" } };
