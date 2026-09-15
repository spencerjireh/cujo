import { cleanChecks, findings, review, run, runningChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { EvidenceLog } from "./EvidenceLog";

const meta: Meta<typeof EvidenceLog> = {
  title: "Run/EvidenceLog",
  component: EvidenceLog,
};
export default meta;

type Story = StoryObj<typeof EvidenceLog>;

/** The demo's blocked run: a detonation that phoned home and three failing tests. */
export const Blocked: Story = { args: { run: run({ status: "blocked" }) } };

/** Nothing tripped: three entries that each say so and fold their tables. */
export const Clean: Story = {
  args: {
    run: run({
      status: "clean",
      checks: cleanChecks,
      findings: [],
      hard_rule_hits: [],
      review: review({ tool: "post_advisory_review" }),
    }),
  },
};

/** Mid-run: entries appear as checks start; no review or end yet. */
export const Running: Story = {
  args: {
    run: run({
      status: "running",
      checks: runningChecks,
      findings: [],
      hard_rule_hits: [],
      review: null,
    }),
  },
};

/** A diff review: no setup, no checks, the reading's own findings on the review entry. */
export const DiffReview: Story = {
  args: {
    run: run({
      mode: "diff",
      status: "clean",
      checks: [],
      findings: findings
        .slice(2, 3)
        .map((f) => ({ ...f, check: "diff", severity: "info" as const })),
      hard_rule_hits: [],
      review: review({ tool: "post_advisory_review" }),
    }),
  },
};

/** The timeline asked for `tests`: its evidence opens and the log scrolls there. */
export const Picked: Story = {
  args: { run: run({ status: "blocked" }), picked: { check: "tests", nonce: 1 } },
};
