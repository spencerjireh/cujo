import { review } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReviewPanel } from "./ReviewPanel";

const meta: Meta<typeof ReviewPanel> = {
  title: "Run/ReviewPanel",
  component: ReviewPanel,
};
export default meta;

type Story = StoryObj<typeof ReviewPanel>;

export const Drafted: Story = { args: { review: review(), posted: false } };

export const Posted: Story = { args: { review: review(), posted: true } };

export const Advisory: Story = {
  args: { review: review({ tool: "post_advisory_review" }), posted: true },
};

export const NoInlineComments: Story = {
  args: { review: review({ comments: [] }), posted: false },
};

/** Exercises the markdown that actually appears in a review body. */
export const RichMarkdown: Story = {
  args: {
    posted: false,
    review: review({
      body: [
        "## What ran",
        "",
        "| check | outcome |",
        "| --- | --- |",
        "| tests | 3 failed |",
        "| detonation | egress |",
        "",
        "1. Base passed.",
        "2. Head failed.",
        "",
        "> The install-time egress is the blocking one.",
        "",
        "```",
        "pip install evil-package==1.0.0",
        "```",
        "",
        "See [the run](https://example.com/runs/run-1).",
      ].join("\n"),
    }),
  },
};

/**
 * The body is agent-authored, so it is untrusted. Script tags, event handlers,
 * and javascript: links must not survive the sanitizer.
 */
export const HostileMarkdown: Story = {
  args: {
    posted: false,
    review: review({
      body: [
        "Normal text.",
        "",
        "<script>window.alert('xss')</script>",
        "",
        '<img src=x onerror="window.alert(1)">',
        "",
        "[click me](javascript:alert(1))",
      ].join("\n"),
    }),
  },
};
