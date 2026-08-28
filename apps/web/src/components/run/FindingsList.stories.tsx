import type { RunStatus } from "@/lib/api/types";
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
export const Mixed: Story = { args: { findings, status: "blocked_pending" } };

export const OnlyCritical: Story = {
  args: {
    findings: findings.filter((finding) => finding.severity === "critical"),
    status: "blocked_pending" as RunStatus,
  },
};

/** The clean run: the empty state has to read as a result, not as a failure. */
export const Empty: Story = { args: { findings: [], status: "clean" } };

/**
 * The same empty list on a live run must not claim every check ran: missing
 * checks only become findings at turn.done.
 */
export const EmptyWhileRunning: Story = { args: { findings: [], status: "running" } };

/** A finding with a diff anchor, which is what becomes an inline comment. */
export const WithAnchor: Story = {
  args: {
    findings: findings.filter((finding) => finding.path !== undefined),
    status: "blocked_posted" as RunStatus,
  },
};
