import { bot, health, twoProviders, unconfigured } from "@/lib/owner/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { seeded } from "../seeded";
import { SettingsView } from "./SettingsView";

const meta: Meta<typeof SettingsView> = {
  title: "Owner/SettingsView",
  component: SettingsView,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof SettingsView>;

/** Configured and running; the App is short one permission, so setup shows that step. */
export const Ready: Story = { decorators: [seeded()] };

/** Every permission held: no checklist, just the settings. */
export const AllSet: Story = {
  decorators: [
    seeded({ bot: { ...bot, permissions: bot.permissions.map((p) => ({ ...p, ok: true })) } }),
  ],
};

/** The harness is still registering its settings. */
export const Bootstrapping: Story = {
  decorators: [
    seeded({
      health: {
        harness: "bootstrapping",
        store: "ok",
        configured: false,
        uptimeMs: 12_000,
        ready: false,
      },
    }),
  ],
};

/** Booted with no model: the checklist leads, and the provider list is empty. */
export const Unconfigured: Story = {
  decorators: [seeded({ settings: unconfigured, health: { ...health, configured: false } })],
};

/** Anthropic beside an OpenAI-compatible host; the picker offers both. */
export const TwoProviders: Story = { decorators: [seeded({ settings: twoProviders })] };

/** GitHub did not answer: the App section says so, and the settings still work. */
export const GitHubDown: Story = { decorators: [seeded({ bot: null })] };
