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

/** Advisory reviews post during the turn, so they are never shown as drafts. */
export const Advisory: Story = {
  args: { review: review({ tool: "post_advisory_review" }), posted: true },
};

/** The accusation while it waits: the only state that reads as held. */
export const GatedHeld: Story = {
  args: { review: review({ tool: "post_gated_review" }), posted: false },
};

/**
 * The same accusation once a maintainer confirmed it. "Held" is what the review
 * still *is*, not what its tool was called, so a confirmed one reads like any
 * other posted request-changes review.
 */
export const GatedConfirmed: Story = {
  args: { review: review({ tool: "post_gated_review" }), posted: true },
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
        "pip install tainted-sample==1.0.0",
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
        "",
        // A body that closes a fold `github-mcp` opened would spill the rest of
        // the review out of it. `safeText` escapes these on the way out, so
        // reaching the board at all means something upstream regressed.
        "</details><summary>escaped</summary>",
      ].join("\n"),
    }),
  },
};

/**
 * The body as `github-mcp` composes it now (decision 74): verdict first, the
 * findings by severity, then the coverage and egress, then the folds.
 *
 * This is the story to look at when changing `.cujo-prose details` — the board
 * has to render the folds collapsed and labelled, the way GitHub does, rather
 * than as an unlabelled wall of JSON.
 */
export const ComposedBody: Story = {
  args: {
    posted: true,
    review: review({
      body: [
        "**Blocked** — 1 critical, 1 warn",
        "",
        "A dependency added by this PR reads `~/.aws/credentials` while it installs.",
        "",
        "### Critical",
        "",
        "**the seeded decoy secret was read** · `detonation` · `pyproject.toml:7`",
        "",
        "> secret_probe.decoy_read: true; read at 12:04:31 inside `pip install tainted-sample==1.0.0`",
        "",
        "Nothing in the package's stated purpose needs the environment or a socket.",
        "",
        "Next: drop the dependency, or pin an audited version and re-run.",
        "",
        "### Warn",
        "",
        "**the new refund path has no test covering it** · `probes` · `app/refunds.py:17` (not in this diff)",
        "",
        "> refund_window() is called by nothing under tests/",
        "",
        "### Coverage",
        "",
        "Ran: tests (212 on base and head), probes (3 scripts), smoke, detonation (1 dependency).",
        "Not run: nothing.",
        "",
        "Egress: 1 unknown host — 185.220.101.4:443.",
        "",
        "<details>",
        "<summary>Hosts contacted (2)</summary>",
        "",
        "| host | port | known |",
        "| --- | --- | --- |",
        "| `pypi.org` | 443 | yes |",
        "| `185.220.101.4` | 443 | **no** |",
        "",
        "</details>",
        "",
        "<details>",
        "<summary>Machine-readable summary</summary>",
        "",
        "```json",
        '{"schema_version":1,"verdict":"blocked","counts":{"critical":1,"warn":1,"info":0,"held":0}}',
        "```",
        "",
        "</details>",
        "",
        "---",
        "",
        "**[View the full evidence →](https://cujo.example.com/runs/8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e)**",
      ].join("\n"),
      comments: [
        {
          path: "pyproject.toml",
          line: 7,
          side: "RIGHT",
          body: "**critical — the seeded decoy secret was read**\n\n> read at 12:04:31 inside `pip install tainted-sample==1.0.0`",
        },
      ],
    }),
  },
};
