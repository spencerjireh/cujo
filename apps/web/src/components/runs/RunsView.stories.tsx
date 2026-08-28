import { PlaneProvider } from "@/app/providers";
import { runKeys } from "@/lib/api/keys";
import type { Mode } from "@/lib/api/mode";
import type { RunSummary } from "@/lib/api/types";
import { runs } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunsView } from "./RunsView";

function withRuns(seed: RunSummary[] | undefined, mode: Mode = "operator") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(runKeys.list(mode), { runs: seed });
  return function Decorated(Story: () => React.ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <PlaneProvider mode={mode}>
          <Story />
        </PlaneProvider>
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof RunsView> = {
  title: "Pages/RunsView",
  component: RunsView,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof RunsView>;

export const Populated: Story = { decorators: [withRuns(runs)] };

/** A fresh install with nothing recorded yet. */
export const Empty: Story = { decorators: [withRuns([])] };

/** The anonymous board: the same table, said to be public pull requests only. */
export const Public: Story = { decorators: [withRuns(runs, "public")] };
