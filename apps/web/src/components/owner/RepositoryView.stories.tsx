import { runKeys } from "@/lib/api/keys";
import type { RepositorySettingsView } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { runs } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RepositoryView } from "./RepositoryView";

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(ownerKeys.settings(REPO), seed);
  client.setQueryData(runKeys.list(), { runs: runs.map((run) => ({ ...run, repo: REPO })) });
  return function Decorated(Story: () => React.ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof RepositoryView> = {
  title: "Owner/RepositoryView",
  component: RepositoryView,
  args: { repo: REPO },
};
export default meta;
type Story = StoryObj<typeof RepositoryView>;

/** Nothing set anywhere: the instance's default, an empty box for instructions. */
export const Unset: Story = { decorators: [withSettings(view())] };

/** The board sets both; nothing in the repository contradicts it. */
export const BoardSet: Story = {
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

/** The repository's own file speaks for both, and the board's choices are shown as shadowed. */
export const FileWins: Story = {
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
