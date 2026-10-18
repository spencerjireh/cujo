import { setupSteps } from "@/lib/owner/activity";
import { bot, health, instanceView, repositories } from "@/lib/owner/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SetupChecklist } from "./SetupChecklist";

const meta: Meta<typeof SetupChecklist> = {
  title: "Owner/SetupChecklist",
  component: SetupChecklist,
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-6 font-ui">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SetupChecklist>;

/** A fresh install: nothing done yet. */
export const FreshInstall: Story = {
  args: {
    steps: setupSteps({
      bot: { ...bot, installations: [] },
      settings: { ...instanceView.settings, model: null, modelProviders: [] },
      health: { ...health, configured: false },
      repositories: [],
    }),
  },
};

/** One step left: the App is short a permission. */
export const OneLeft: Story = {
  args: {
    steps: setupSteps({ bot, settings: instanceView.settings, health, repositories }),
  },
};
