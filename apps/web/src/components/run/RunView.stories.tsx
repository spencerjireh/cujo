import { runKeys } from "@/lib/api/keys";
import type { Run } from "@/lib/api/types";
import { cleanChecks, findings, review, run, runningChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunView } from "./RunView";

/**
 * The whole page, seeded straight into the Query cache so no network is
 * involved. The stream hook only opens a connection for a live run, so the
 * terminal stories are inert.
 */
function withRun(seed: Run) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(runKeys.detail(seed.id), seed);
  return function Decorated(Story: () => React.ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof RunView> = {
  title: "Pages/RunView",
  component: RunView,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof RunView>;

/** PR 3 from the demo: detonation caught the exfiltration, decision pending. */
export const AwaitingApproval: Story = {
  args: { id: "run-1" },
  decorators: [withRun(run())],
};

/** PR 1 from the demo: everything ran, nothing tripped. */
export const Clean: Story = {
  args: { id: "run-1" },
  decorators: [
    withRun(
      run({
        status: "clean",
        checks: cleanChecks,
        findings: [],
        hard_rule_hits: [],
        review: review({ tool: "post_advisory_review" }),
        summary: "Three checks ran on base and head. Nothing tripped.",
      }),
    ),
  ],
};

/** Mid-run, before any report has landed. */
export const StillRunning: Story = {
  args: { id: "run-1" },
  decorators: [
    withRun(
      run({
        status: "running",
        checks: runningChecks,
        findings: [],
        hard_rule_hits: [],
        review: null,
        summary: null,
      }),
    ),
  ],
};

/** After the decision: the review is posted and the bar explains rather than asks. */
export const Blocked: Story = {
  args: { id: "run-1" },
  decorators: [withRun(run({ status: "blocked_posted" }))],
};

/** Decision 21: an advisory review posted while a hard rule had tripped. */
export const ContradictoryError: Story = {
  args: { id: "run-1" },
  decorators: [
    withRun(
      run({
        status: "error",
        findings,
        error:
          "advisory review posted while a hard rule had tripped: an install contacted an unknown host",
      }),
    ),
  ],
};
