import { run } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RunHeader } from "./RunHeader";

const meta: Meta<typeof RunHeader> = {
  title: "Run/RunHeader",
  component: RunHeader,
};
export default meta;

type Story = StoryObj<typeof RunHeader>;

export const AwaitingApproval: Story = { args: { run: run() } };

export const Clean: Story = {
  args: {
    run: run({
      status: "clean",
      approval: null,
      summary: "Four checks ran. Nothing tripped.",
    }),
  },
};

export const Decided: Story = {
  args: { run: run({ status: "blocked_posted", approver: "op@example.com", approval: null }) },
};

/**
 * A run that ended in error, including the case decision 21 describes: an
 * advisory review posted while a hard rule had tripped.
 */
export const Errored: Story = {
  args: {
    run: run({
      status: "error",
      approval: null,
      error:
        "advisory review posted while a hard rule had tripped: an install contacted an unknown host",
    }),
  },
};

export const NoSummaryYet: Story = {
  args: { run: run({ status: "running", approval: null, summary: null, review: null }) },
};

/**
 * A run claimed before the title and the author were stored, or one whose PR
 * read never completed. The heading falls back to `repo #N` and the author line
 * is absent, which is exactly the header every run had before decision 54.
 */
export const NoTitleOrAuthor: Story = {
  args: { run: run({ pr_title: null, pr_author_login: null, pr_author_id: null }) },
};

/** A bot opened it: named with its avatar, and not linked (decision 54). */
export const OpenedByABot: Story = {
  args: { run: run({ pr_author_login: "dependabot[bot]", pr_author_id: 49699333 }) },
};
