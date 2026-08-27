import { findings } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FindingsList } from "./FindingsList";

const meta: Meta<typeof FindingsList> = {
  title: "Run/FindingsList",
  component: FindingsList,
};
export default meta;

type Story = StoryObj<typeof FindingsList>;

/** Presorted by the API: critical first, then warn, then info. */
export const Mixed: Story = { args: { findings } };

export const OnlyCritical: Story = {
  args: { findings: findings.filter((finding) => finding.severity === "critical") },
};

/** The clean run: the empty state has to read as a result, not as a failure. */
export const Empty: Story = { args: { findings: [] } };

/** A finding with a diff anchor, which is what becomes an inline comment. */
export const WithAnchor: Story = {
  args: { findings: findings.filter((finding) => finding.path !== undefined) },
};
