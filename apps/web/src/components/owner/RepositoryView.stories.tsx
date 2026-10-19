import type { RepositorySettingsView } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RepositoryView } from "./RepositoryView";
import { seeded } from "./seeded";

const REPO = "spencerjireh/orders-api";

function view(over: Partial<RepositorySettingsView> = {}): RepositorySettingsView {
  return {
    board: { mode: null, instructions: null, updated_at: null },
    file: { mode: null, instructions: null, path: ".cujo/REVIEW.md" },
    instance: { mode: "sandbox" },
    effective: { mode: { value: "sandbox", source: "instance" }, instructions: null },
    ...over,
  };
}

function withSettings(seed: RepositorySettingsView) {
  return seeded({ extra: (client) => client.setQueryData(ownerKeys.settings(REPO), seed) });
}

const meta: Meta<typeof RepositoryView> = {
  title: "Owner/RepositoryView",
  component: RepositoryView,
  args: { repo: REPO },
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof RepositoryView>;

/** The Runs tab, which a repository opens on. */
export const Runs: Story = { decorators: [withSettings(view())] };

/** Review settings with nothing set: the default applies, an empty box for instructions. */
export const Unset: Story = {
  decorators: [withSettings(view())],
  parameters: { nextjs: { navigation: { query: { tab: "settings" } } } },
};

/** Both set here; nothing in the repository contradicts it. */
export const SetHere: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "settings" } } } },
  decorators: [
    withSettings(
      view({
        board: {
          mode: "diff",
          instructions: "Ignore anything under docs/. Money math is the thing to read.",
          updated_at: "2026-09-15T10:00:00Z",
        },
        effective: {
          mode: { value: "diff", source: "board" },
          instructions: {
            text: "Ignore anything under docs/. Money math is the thing to read.",
            truncated: false,
            source: "board",
          },
        },
      }),
    ),
  ],
};

/** The repository's own files set both: the controls are disabled and say why. */
export const FileWins: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "settings" } } } },
  decorators: [
    withSettings(
      view({
        board: {
          mode: "diff",
          instructions: "Old board text.",
          updated_at: "2026-09-01T10:00:00Z",
        },
        file: {
          mode: "sandbox",
          instructions:
            "# Reviewing orders-api\n\nRun the suite; the rounding tests are the contract.",
          path: ".cujo/REVIEW.md",
        },
        effective: {
          mode: { value: "sandbox", source: "file" },
          instructions: {
            text: "# Reviewing orders-api\n\nRun the suite; the rounding tests are the contract.",
            truncated: false,
            source: "file",
          },
        },
      }),
    ),
  ],
};
