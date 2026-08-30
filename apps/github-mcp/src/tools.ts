/**
 * The three review tools (docs/spec.md Contract 4). Near enough the same input
 * — the two that can precede an accusation take one flag more, and that is the
 * only asymmetry; two of them post the same REQUEST_CHANGES review, and the
 * only difference between those two is which one `apps/cujo` names in
 * `requireApprovalForTools`. So the
 * server cannot tell them apart by what it does — the name has to be passed to
 * `postReview` rather than derived from the review event — and this file is
 * write-only by design (decision 5), with no access to the check reports, so
 * it cannot tell a tests-fail body from an exfiltration body either. Which
 * review is an accusation is decided in the rubric and re-derived in
 * `apps/cujo`; here it is only a tool name.
 */

import { type Logger, createLogger, errorFields } from "@cujo/log";
import { type ReviewTool, renderReviewBody, reviewComments } from "@cujo/review-render";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appendConfirmPrompt,
  appendReviewMarker,
  appendRunFooter,
  reviewMarker,
  runUrl,
} from "./body";
import { appendMovedComments, validateAnchors } from "./diff";
import type { ExistingReview, GitHubClient } from "./github";

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
  body: z
    .string()
    .min(1)
    .describe(
      "One sentence: the verdict in plain language. Not a summary — the server composes the headline, the findings, the coverage caveat and the egress line from the fields below. Never write a verdict word (blocked, advisory) into it.",
    ),
  findings: z
    .array(
      z.object({
        check: z.string().min(1).describe("tests, probes, smoke, detonation, or review."),
        severity: z.enum(["info", "warn", "critical"]),
        title: z
          .string()
          .min(1)
          .describe(
            "One clause of plain language: what happened, not which sensor field said so. Never a field name like secret_probe.decoy_read.",
          ),
        evidence: z
          .string()
          .default("")
          .describe(
            "The observation itself: the failing assertion, the host and port, the path written. Numbers, not adjectives.",
          ),
        detail: z
          .string()
          .optional()
          .describe(
            "One paragraph of judgment: why the evidence supports the claim, and what it rules out. Expected on every critical.",
          ),
        next: z
          .string()
          .optional()
          .describe(
            "One imperative clause naming the action. Required on critical, allowed on warn, never on info. It must follow from an observed signal — never style, architecture, naming, or preference.",
          ),
        held: z
          .boolean()
          .default(false)
          .describe(
            "This is a malice observation whose conclusion a post_gated_review call is holding back. Set it only on the findings marked warn for that reason, on the same call that passes accusation_follows.",
          ),
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
        side: z.enum(["LEFT", "RIGHT"]).optional(),
      }),
    )
    .default([])
    .describe(
      "Every finding. The server renders them by severity and derives the inline comments from them: one carrying path and line becomes a comment on that diff line. There is no comments parameter.",
    ),
  // Deprecated, and kept only for the migration (decision 74). The rubric no
  // longer asks for this and new calls do not send it — anchors ride on the
  // findings. But a session pins its rubric at creation (decision 16), so an
  // in-flight pull request goes on sending the old shape for as long as its
  // session lives, and deleting the key outright made Zod strip it: those
  // reviews would have posted whatever the findings happened to anchor and
  // silently dropped the comments the model actually wrote. Present and
  // preferred when non-empty, so a legacy call posts exactly what it always
  // did. Remove it once no session predating decision 74 can still be running.
  comments: z
    .array(
      z.object({
        path: z.string().min(1),
        line: z.number().int().positive(),
        side: z.enum(["LEFT", "RIGHT"]).optional(),
        body: z.string().min(1),
      }),
    )
    .default([])
    .describe(
      "Deprecated; do not send. Anchor a finding with path and line instead and it becomes an inline comment. Accepted only so a session created before the review body was composed server-side keeps posting the comments it wrote.",
    ),
  coverage: z
    .object({
      ran: z
        .array(
          z.object({
            check: z.string().min(1),
            note: z.string().optional().describe('Short, e.g. "212 on base and head".'),
          }),
        )
        .default([]),
      skipped: z
        .array(z.object({ check: z.string().min(1), reason: z.string().min(1) }))
        .default([]),
    })
    .optional()
    .describe(
      "What this review covers and what it does not. Do not write the caveat into body: a caveat in a parenthesis is a caveat nobody reads.",
    ),
  egress: z
    .array(
      z.object({
        host: z.string().min(1),
        port: z.number().int().positive().optional(),
        known: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Every host contacted, each marked known or unknown. The server writes the summary line and the host table.",
    ),
  // An id, not a URL. A URL from the agent would let whatever it just read in
  // the pull request choose where the evidence link points, and `z.string().url()`
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

/**
 * What the two observation tools take on top of the common shape.
 *
 * Only they: `post_gated_review` is registered with the bare
 * `reviewInputShape`, so the flag does not exist there and the prompt cannot be
 * asked for on the call where it would be false. That is the whole guarantee,
 * and it is structural rather than a check somebody has to remember to write.
 *
 * It has to be passed rather than derived, because this server cannot tell an
 * accusation from a broken test (decision 5) and cannot see whether a gated
 * call follows. A model that forgets it leaves the prompt off an observation,
 * which is the same "correct or absent" failure the run footer already accepts.
 */
const observationInputShape = {
  ...reviewInputShape,
  accusation_follows: z
    .boolean()
    .default(false)
    .describe(
      "True when a post_gated_review call follows this one. Cujo appends the sentence telling the maintainer to reply /cujo confirm or /cujo dismiss; do not write it into body yourself.",
    ),
};

const reviewInputSchema = z.object(reviewInputShape);
const observationInputSchema = z.object(observationInputShape);
export type ReviewInput = z.infer<typeof reviewInputSchema>;
/** A review the agent posts on its own authority, which may hold an accusation back. */
export type ObservationInput = z.infer<typeof observationInputSchema>;

export interface ReviewResult {
  review_id: number;
  html_url: string;
  posted_inline: number;
  moved_to_body: number;
}

/** The tools that post a review. The name rides on the log line, so it is passed. */
export type { ReviewTool };

export async function postReview(
  github: GitHubClient,
  event: "COMMENT" | "REQUEST_CHANGES",
  tool: ReviewTool,
  input: ReviewInput | ObservationInput,
  publicBaseUrl = "",
  log: Logger = createLogger({ service: "github-mcp" }),
): Promise<ReviewResult> {
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

  /**
   * A review this run has already posted with this tool, if there is one.
   *
   * `type === "Bot"` and not just the marker text. A marker is copyable: a
   * stranger who pastes one into their own review body would otherwise suppress
   * Cujo's. This server holds no bot login of its own, so the account type is
   * the check available without new configuration.
   */
  async function alreadyPosted(marker: string): Promise<ExistingReview | undefined> {
    if (!marker) return undefined;
    const existing = await github.listReviews(input.repo, input.pr_number);
    return existing.find(
      (review) => review.user?.type === "Bot" && (review.body ?? "").includes(marker),
    );
  }

  function duplicate(already: ExistingReview): ReviewResult {
    log.info("review.duplicate.skipped", {
      repo: input.repo,
      pr_number: input.pr_number,
      head_sha: input.head_sha,
      tool,
      review_id: String(already.id),
    });
    // The review that is already there, rather than an error. A thrown tool
    // error is something the model may work around or retry, and "idempotent"
    // means the second call answers like the first.
    return {
      review_id: already.id,
      html_url: already.html_url,
      posted_inline: 0,
      moved_to_body: 0,
    };
  }

  async function post(): Promise<ReviewResult> {
    // Checked twice, and the second one is the one that matters.
    //
    // This is a check-then-act sequence and GitHub offers no conditional create
    // for a review, so it cannot be made atomic here. What it can be is narrow:
    // the first check runs before the file listing and the anchor validation,
    // so the common case — a model that calls the tool twice — costs one API
    // call instead of three and posts nothing. The second runs immediately
    // before `createReview`, which shrinks the window two concurrent calls
    // would have to land inside from "three API calls wide" to "one".
    //
    // Two genuinely simultaneous calls can still both post. Closing that needs
    // state neither this server nor GitHub has: `github-mcp` is stateless by
    // design (decision 5) and builds a fresh MCP server per request.
    // Read by presence and not by tool name: `post_gated_review` registers the
    // bare shape, so the key does not exist on it at all (decision 60). Hoisted
    // to a const because the renderer and the maintainer prompt both need it.
    const accusationFollows = "accusation_follows" in input && input.accusation_follows === true;
    const marker = reviewMarker(tool, input.head_sha, input.run_id);
    const early = await alreadyPosted(marker);
    if (early) return duplicate(early);

    const files = await github.listPullFiles(input.repo, input.pr_number);
    // Derived, not sent (decision 74). A finding carrying an anchor is an
    // inline comment; there is no second array that could disagree with it.
    // A legacy call's own comments win, so an in-flight session posts exactly
    // what it always did; everything else derives from the findings, which is
    // the one source of an anchor now (decision 74).
    const legacy = input.comments ?? [];
    const candidates = legacy.length > 0 ? legacy : reviewComments(input);
    const { inline, moved } = validateAnchors(files, candidates);
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
    // The narrow one. Everything between here and the first check was reads,
    // so a review that appeared during them is one this call must not repeat.
    const late = await alreadyPosted(marker);
    if (late) return duplicate(late);

    // The whole body, composed here rather than written by the model
    // (decision 74). An anchor `validateAnchors` refused is marked on the
    // finding in place, which is what retired the anchorless-findings section:
    // no comment can vanish when every finding is already in the body.
    const composed = renderReviewBody(input, {
      tool,
      accusationFollows,
      runUrl: runUrl(publicBaseUrl, input.run_id),
      // Only meaningful when the comments came from the findings: on a legacy
      // call these keys describe the model's own `comments[]`, which the body
      // does not print, so marking findings against them would be guesswork.
      unanchored:
        legacy.length > 0
          ? new Set<string>()
          : new Set(
              moved.map(
                ({ comment }) => `${comment.path}:${comment.line}:${comment.side ?? "RIGHT"}`,
              ),
            ),
    });

    const review = await github.createReview(input.repo, input.pr_number, {
      commitId: input.head_sha,
      event,
      // Outward-in: the footer is last, so it sits below the composed body
      // rather than inside it (decision 36). The maintainer prompt goes
      // directly above it — both are ours, and a call to action reads better
      // next to the evidence it points at.
      // The marker is outside even the footer: a private repository has no run
      // id, so `appendRunFooter` returns the body unchanged there, and a marker
      // composed inside it would vanish with it.
      body: appendReviewMarker(
        appendRunFooter(
          appendConfirmPrompt(
            // A legacy comment's text lives nowhere but the comment, so one
            // whose anchor GitHub refused would vanish from the review
            // altogether. A derived one is already in the composed body and
            // marked there, which is why this runs on the legacy path only.
            legacy.length > 0 ? appendMovedComments(composed, moved) : composed,
            accusationFollows,
          ),
          publicBaseUrl,
          input.run_id,
        ),
        marker,
      ),
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
        "Post a COMMENT review on the pull request as cujo-guard[bot]. Use when no finding is critical, or as the observation half of a malice finding — the facts the sensors recorded, marked warn, with the accusation itself held for post_gated_review. Set accusation_follows when it is that observation half. Never approves, so it cannot satisfy branch protection.",
      inputSchema: observationInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      asToolResult(
        await postReview(github, "COMMENT", "post_advisory_review", args, publicBaseUrl, log),
      ),
  );

  server.registerTool(
    "post_blocking_review",
    {
      title: "Post blocking review",
      description:
        "Post a REQUEST_CHANGES review on the pull request as cujo-guard[bot], which blocks the merge under branch protection. Use when a critical finding says the pull request is broken — a failing test, a contradicted probe, an endpoint that stopped answering. Use it as the observation half too when a run has both a broken thing and a malice finding, so the confirmed defect blocks without waiting on the accusation — set accusation_follows when it is. Posts at once; nobody is asked.",
      inputSchema: observationInputShape,
      // Destructive, and no longer gated. It blocks a merge, which is real but
      // reversible in one click; the gate moved to the claim that is not
      // (decision 42). The gate is the name in `require_approval_for_tools`,
      // never this hint, so the two can disagree without surprising anyone.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) =>
      asToolResult(
        await postReview(
          github,
          "REQUEST_CHANGES",
          "post_blocking_review",
          args,
          publicBaseUrl,
          log,
        ),
      ),
  );

  server.registerTool(
    "post_gated_review",
    {
      title: "Post gated review",
      description:
        "Post a REQUEST_CHANGES review on the pull request as cujo-guard[bot], for a critical finding that accuses code of acting against the person running it: reading or leaking a secret, writing outside the workspace, or calling an unknown host. Identical to post_blocking_review except that it pauses and posts nothing until a maintainer confirms it, because an accusation that is wrong harms someone. Post the observation as an advisory review first.",
      // The bare shape, deliberately: no `accusation_follows` here, so the
      // maintainer prompt cannot be asked for on the one call where it would
      // be false. Zod strips a key it does not declare, so a model that sends
      // it anyway is simply ignored.
      inputSchema: reviewInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) =>
      asToolResult(
        await postReview(github, "REQUEST_CHANGES", "post_gated_review", args, publicBaseUrl, log),
      ),
  );
}
