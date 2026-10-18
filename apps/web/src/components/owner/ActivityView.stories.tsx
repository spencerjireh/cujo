import { bot, health, repositories, unconfigured } from "@/lib/owner/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityView } from "./ActivityView";
import { seeded } from "./seeded";

const meta: Meta<typeof ActivityView> = {
  title: "Owner/ActivityView",
  component: ActivityView,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof ActivityView>;

const allPermissions = { ...bot, permissions: bot.permissions.map((p) => ({ ...p, ok: true })) };

/** Set up, with blocked and failed pull requests waiting on the owner. */
export const NeedsYou: Story = { decorators: [seeded({ bot: allPermissions })] };

/** Set up, and nothing waiting: only the runs. */
export const NothingWaiting: Story = {
  decorators: [
    seeded({
      bot: allPermissions,
      runs: [],
    }),
  ],
};

/** A fresh install: no model, no repository on, no runs. The checklist leads. */
export const FreshInstall: Story = {
  decorators: [
    seeded({
      settings: unconfigured,
      health: { ...health, configured: false },
      repositories: repositories.map((r) => ({ ...r, enabled: false })),
      runs: [],
    }),
  ],
};
