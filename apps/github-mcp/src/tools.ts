/**
 * The two review tools (docs/spec.md Contract 4). Same input, different
 * review event; only the blocking one is marked destructive, which is what
 * TrueForge's `@destructive` approval selector keys on.
 */

import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendRunFooter } from "./body";
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
  // An id, not a URL. A URL from the agent would let whatever it just read in
  // the pull request choose where "Full evidence" points, and `z.string().url()`
  // additionally accepts embedded newlines — WHATWG parsing strips them, Zod
  // returns the original, and the footer would carry injected Markdown. A UUID
  // admits neither: this server owns the host and the shape.
  run_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "The run id, copied verbatim from `run_id` in the input payload. Omit it when the input has none. Do not write a link into `body`; the server builds the footer.",
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
  publicBaseUrl = "",
  log: Logger = createLogger({ service: "github-mcp" }),
): Promise<ReviewResult> {
  const tool = event === "REQUEST_CHANGES" ? "post_blocking_review" : "post_advisory_review";
  try {
    return await post();
  } catch (error) {
    // The one outward write this system makes, and the case that mattered
    // most was the one with no line at all: a failed file listing, a rejected
    // anchor set or a refused review left `server.ts`'s transport catch as the
    // only record, and that one knows neither the repo nor the pull request.
    log.error("review.failed", {
      repo: input.repo,
      pr_number: input.pr_number,
      head_sha: input.head_sha,
      tool,
      ...errorFields(error),
    });
    throw error;
  }

  async function post(): Promise<ReviewResult> {
    const files = await github.listPullFiles(input.repo, input.pr_number);
    const { inline, moved } = validateAnchors(files, input.comments);
    for (const { comment, reason } of moved) {
      // One line per rejected anchor, because `moved_to_body` is a count with
      // no explanation: an agent citing a file the PR does not touch and one
      // citing a real file outside the hunk are different mistakes, and only
      // the first suggests the rubric is pointing it at the wrong thing.
      log.info("review.anchor.moved", {
        repo: input.repo,
        pr_number: input.pr_number,
        path: comment.path,
        reason,
      });
    }
    const review = await github.createReview(input.repo, input.pr_number, {
      commitId: input.head_sha,
      event,
      // Outward-in: the footer is last, so it sits below the findings that lost
      // their diff anchor rather than between them and the body (decision 36).
      body: appendRunFooter(appendMovedComments(input.body, moved), publicBaseUrl, input.run_id),
      comments: inline,
    });
    // The only outward write this system makes, and until now the only one it
    // did not record.
    log.info("review.posted", {
      repo: input.repo,
      pr_number: input.pr_number,
      head_sha: input.head_sha,
      tool,
      review_id: String(review.id),
      html_url: review.html_url,
      posted_inline: inline.length,
      moved_to_body: moved.length,
      findings: input.findings.length,
    });
    return {
      review_id: review.id,
      html_url: review.html_url,
      posted_inline: inline.length,
      moved_to_body: moved.length,
    };
  }
}

function asToolResult(result: ReviewResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { ...result },
  };
}

export function registerReviewTools(
  server: McpServer,
  github: GitHubClient,
  publicBaseUrl = "",
  log: Logger = createLogger({ service: "github-mcp" }),
): void {
  server.registerTool(
    "post_advisory_review",
    {
      title: "Post advisory review",
      description:
        "Post a COMMENT review on the pull request as cujo-guard[bot]. Use when no finding is critical. Never approves, so it cannot satisfy branch protection.",
      inputSchema: reviewInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => asToolResult(await postReview(github, "COMMENT", args, publicBaseUrl, log)),
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
    async (args) =>
      asToolResult(await postReview(github, "REQUEST_CHANGES", args, publicBaseUrl, log)),
  );
}
