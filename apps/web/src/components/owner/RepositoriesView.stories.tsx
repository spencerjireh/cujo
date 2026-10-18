import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RepositoriesView } from "./RepositoriesView";
import { seeded } from "./seeded";

const meta: Meta<typeof RepositoriesView> = {
  title: "Owner/RepositoriesView",
  component: RepositoriesView,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof RepositoriesView>;

/** Three held, one lost: last run and open blocks beside each switch, the lost one dimmed. */
export const Installed: Story = { decorators: [seeded()] };
/** A fresh instance before the App is on anything. */
export const Empty: Story = { decorators: [seeded({ repositories: [], runs: [] })] };
