import { RUN_STATUSES } from "@/lib/api/types";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusBadge } from "./StatusBadge";

const meta: Meta<typeof StatusBadge> = {
  title: "Primitives/StatusBadge",
  component: StatusBadge,
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const AwaitingApproval: Story = { args: { status: "blocked_pending" } };
export const Running: Story = { args: { status: "running" } };
export const Blocked: Story = { args: { status: "blocked_posted" } };
export const Superseded: Story = { args: { status: "superseded" } };

/** Every status a run can reach, so the wording can be compared at a glance. */
export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {RUN_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
