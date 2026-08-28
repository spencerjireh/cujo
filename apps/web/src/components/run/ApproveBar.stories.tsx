import { review, run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApproveBar } from "./ApproveBar";

/**
 * Every run status, because the bar either offers a decision or explains why it
 * cannot — and the "cannot" cases are the ones that are hard to reach on a live
 * stack.
 */
const meta: Meta<typeof ApproveBar> = {
  title: "Run/ApproveBar",
  component: ApproveBar,
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ApproveBar>;

/** The decision the demo lands on. */
export const AwaitingApproval: Story = { args: { run: run() } };

/** An advisory review awaiting approval reads differently: no merge is held. */
export const AdvisoryPending: Story = {
  args: {
    run: run({
      review: review({ tool: "post_advisory_review" }),
    }),
  },
};

export const AlreadyApproved: Story = {
  args: { run: run({ status: "blocked_posted", approver: "op@example.com", approval: null }) },
};

export const Denied: Story = {
  args: { run: run({ status: "denied", approver: "op@example.com", approval: null }) },
};

/** A newer commit replaced this run, so the decision belongs on another page. */
export const Superseded: Story = {
  args: { run: run({ status: "superseded", approval: null }) },
};

/**
 * The Contract 6 tripwire: a subagent asked for the review tool, so the run is
 * paused with no approval recorded and must never offer a button.
 */
export const TripwirePaused: Story = {
  args: { run: run({ status: "blocked_pending", approval: null }) },
};

/** Resumed from the harness console rather than here. */
export const ResumedExternally: Story = {
  args: {
    run: run({
      status: "blocked_posted",
      approver: "external",
      approval: null,
      external_resume: true,
    }),
  },
};

export const StillRunning: Story = {
  args: { run: run({ status: "running", approval: null, review: null }) },
};
