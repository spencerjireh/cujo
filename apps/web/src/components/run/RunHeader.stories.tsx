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
      summary: "Four checks ran. Nothing tripped.",
    }),
  },
};

export const Blocked: Story = {
  args: { run: run({ status: "blocked" }) },
};

/** A maintainer lifted the block: the review is dismissed and the check neutral. */
export const Dismissed: Story = {
  args: { run: run({ status: "dismissed" }) },
};

/**
 * A run that ended in error, including the case decision 21 describes: an
 * advisory review posted while a hard rule had tripped.
 */
export const Errored: Story = {
  args: {
    run: run({
      status: "error",
      error:
        "advisory review posted while a hard rule had tripped: an install contacted an unknown host",
    }),
  },
};

export const NoSummaryYet: Story = {
  args: { run: run({ status: "running", summary: null, review: null }) },
};

/**
 * A run claimed before the title and the author were stored, or one whose PR
 * read never completed. The heading falls back to `repo #N` and the author line
 * is absent, which is exactly the header every run had before decision 55.
 */
export const NoTitleOrAuthor: Story = {
  args: { run: run({ pr_title: null, pr_author_login: null, pr_author_id: null }) },
};

/** A bot opened it: named with its avatar, and not linked (decision 55). */
export const OpenedByABot: Story = {
  args: { run: run({ pr_author_login: "dependabot[bot]", pr_author_id: 49699333 }) },
};

/**
 * A diff run (decision 135): the chip beside the badge is what tells this
 * `clean` from the one above, which ran four checks.
 */
export const DiffReview: Story = {
  args: {
    run: run({
      status: "clean",
      mode: "diff",
      checks: [],
      budget_tokens: 400_000,
      summary: "Read against CONTRIBUTING.md. Two warnings, both anchored.",
    }),
  },
};
