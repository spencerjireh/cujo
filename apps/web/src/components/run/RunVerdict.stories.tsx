import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RunVerdict } from "./RunVerdict";

const meta: Meta<typeof RunVerdict> = {
  title: "Run/RunVerdict",
  component: RunVerdict,
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof RunVerdict>;

/** Four critical findings, each with its place, and both ways out. */
export const Blocked: Story = { args: { run: run() } };
export const Clean: Story = {
  args: {
    run: run({
      status: "clean",
      findings: run().findings.filter((f) => f.severity !== "critical"),
    }),
  },
};
export const Running: Story = { args: { run: run({ status: "running" }) } };
export const Dismissed: Story = { args: { run: run({ status: "dismissed" }) } };
export const ErrorStatus: Story = {
  name: "Error",
  args: { run: run({ status: "error", findings: [] }) },
};
export const Unproven: Story = { args: { run: run({ status: "unproven", findings: [] }) } };
export const Superseded: Story = { args: { run: run({ status: "superseded" }) } };
