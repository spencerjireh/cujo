import { SEVERITIES } from "@/lib/api/types";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SeverityBadge } from "./SeverityBadge";

const meta: Meta<typeof SeverityBadge> = {
  title: "Primitives/SeverityBadge",
  component: SeverityBadge,
};
export default meta;

type Story = StoryObj<typeof SeverityBadge>;

export const Critical: Story = { args: { severity: "critical" } };
export const Warn: Story = { args: { severity: "warn" } };
export const Info: Story = { args: { severity: "info" } };

/** All three together: `warn` takes the amber slot, `critical` stays red. */
export const Ramp: Story = {
  render: () => (
    <div className="flex gap-2">
      {SEVERITIES.map((severity) => (
        <SeverityBadge key={severity} severity={severity} />
      ))}
    </div>
  ),
};
