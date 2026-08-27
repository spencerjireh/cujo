/**
 * The two review tools (docs/spec.md Contract 4). Same input, different
 * review event; only the blocking one is marked destructive, which is what
 * TrueForge's `@destructive` approval selector keys on.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendMovedComments, validateAnchors } from "./diff";
import type { GitHubClient } from "./github";

export const reviewInputShape = {
  repo: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be "owner/name"')
    .describe('Repository full name, "owner/name".'),
  pr_number: z.number().int().positive().describe("Pull request number."),
  head_sha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .describe("Head commit SHA the review is about."),
  body: z.string().min(1).describe("Review summary in Markdown: what ran, results, egress."),
  comments: z
    .array(
      z.object({
        path: z.string().min(1).describe("File path in the PR."),
        line: z.number().int().positive().describe("Line in the PR diff."),
        side: z
          .enum(["LEFT", "RIGHT"])
          .optional()
          .describe("RIGHT (head, default) or LEFT (base)."),
        body: z.string().min(1).describe("The finding, in Markdown."),
      }),
    )
    .default([])
    .describe("Inline findings. One without a valid diff anchor moves into the body."),
  findings: z
    .array(
      z.object({
        check: z.string().min(1).describe("tests, probes, smoke, detonation, or review."),
        severity: z.enum(["info", "warn", "critical"]),
        title: z.string().min(1),
        evidence: z.string().default(""),
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
        side: z.enum(["LEFT", "RIGHT"]).optional(),
      }),
    )
    .default([])
    .describe(
      "Every finding with its severity. Not posted; Cujo reads it from the tool call to show the run.",
    ),
};

const reviewInputSchema = z.object(reviewInputShape);
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export interface ReviewResult {
  review_id: number;
  html_url: string;
  posted_inline: number;
  moved_to_body: number;
}

export async function postReview(
  github: GitHubClient,
  event: "COMMENT" | "REQUEST_CHANGES",
  input: ReviewInput,
): Promise<ReviewResult> {
  const files = await github.listPullFiles(input.repo, input.pr_number);
  const { inline, moved } = validateAnchors(files, input.comments);
  const review = await github.createReview(input.repo, input.pr_number, {
    commitId: input.head_sha,
    event,
    body: appendMovedComments(input.body, moved),
    comments: inline,
  });
  return {
    review_id: review.id,
    html_url: review.html_url,
    posted_inline: inline.length,
    moved_to_body: moved.length,
  };
}

function asToolResult(result: ReviewResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { ...result },
  };
}

export function registerReviewTools(server: McpServer, github: GitHubClient): void {
  server.registerTool(
    "post_advisory_review",
    {
      title: "Post advisory review",
      description:
        "Post a COMMENT review on the pull request as cujo-guard[bot]. Use when no finding is critical. Never approves, so it cannot satisfy branch protection.",
      inputSchema: reviewInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => asToolResult(await postReview(github, "COMMENT", args)),
  );

  server.registerTool(
    "post_blocking_review",
    {
      title: "Post blocking review",
      description:
        "Post a REQUEST_CHANGES review on the pull request as cujo-guard[bot], which blocks the merge under branch protection. Use only when at least one finding is critical. This action pauses for human approval.",
      inputSchema: reviewInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => asToolResult(await postReview(github, "REQUEST_CHANGES", args)),
  );
}
