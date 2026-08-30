"use client";

import type { DraftedReview } from "@/lib/api/types";
import { renderMarkdown } from "@/lib/markdown";
import { useEffect, useState } from "react";

/**
 * The review as it will appear on GitHub. `composed_body` is what `github-mcp`
 * actually posts — the verdict headline, the findings, the coverage and the
 * egress — reproduced here by the same renderer (decision 74); `body` is the
 * model's one-sentence lede and is the fallback for a run folded before that
 * field existed. Either way it is markdown built from text an agent wrote, so
 * it is untrusted: parsed, then sanitized against a small allowlist
 * (lib/markdown.ts).
 *
 * Sanitizing runs after mount, never during render. DOMPurify needs a real DOM,
 * and Next server-renders client components for the first paint, so calling it
 * in render throws on the server. Rendering the body as plain text until the
 * effect runs also keeps the server and first client render identical, so there
 * is no hydration mismatch — and the pre-sanitized state is inert text, never
 * markup.
 */
export function ReviewPanel({
  review,
  posted,
  advisoryStands = false,
}: {
  review: DraftedReview;
  posted: boolean;
  /**
   * Whether an advisory review is already on the pull request. Only read while
   * this one is held, where it changes what dismissing means: on the malice
   * path the observation posted before the gate, so a dismissal leaves
   * something standing rather than ending in silence.
   */
  advisoryStands?: boolean;
}) {
  const markdown = review.composed_body || review.body;
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => setHtml(renderMarkdown(markdown)), [markdown]);
  const blocking = review.tool !== "post_advisory_review";
  // Gated is what the tool *is*; held is what it still is. A confirmed
  // accusation is on the pull request like any other review, and calling it
  // held after somebody answered describes the tool rather than the run.
  const held = review.tool === "post_gated_review" && !posted;

  // What the two words on the pinned line actually do. It used to be said on
  // that line, where it needed three clauses and most of the bottom of the
  // window; it belongs against the review it decides.
  const stakes = held
    ? `Confirming posts this as REQUEST_CHANGES and holds the merge. ${
        advisoryStands
          ? "The advisory review is already on the pull request; dismissing leaves it standing and posts nothing more."
          : "Dismissing ends the run without posting it."
      }`
    : posted
      ? "The comment as it went to the pull request."
      : "Drafted by this run. Nothing was posted.";

  return (
    <section aria-label={held ? "Held review" : "Review"}>
      <h2 className="mb-1 flex flex-wrap items-center gap-3 text-lg">
        {held ? "Held for a human" : posted ? "Review" : "Drafted review"}
        <span
          className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${
            blocking ? "bg-sev-critical-bg text-sev-critical" : "bg-sev-info-bg text-sev-info"
          }`}
        >
          {held ? "request changes — held" : blocking ? "request changes" : "comment"}
        </span>
      </h2>
      <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">{stakes}</p>

      {html === null ? (
        <p className="max-w-[68ch] whitespace-pre-wrap text-sm">{markdown}</p>
      ) : (
        <div
          className="cujo-prose max-w-[68ch] text-sm"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized in lib/markdown.ts
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {review.comments.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-muted">
            Anchored findings ({review.comments.length})
          </h3>
          <p className="mb-2 max-w-[68ch] text-xs text-fg-muted">
            The comments Cujo asked GitHub to place. Validating an anchor needs the pull request
            diff, which this side does not have, so one whose line is not in the diff appears in the
            body above instead.
          </p>
          <ul>
            {review.comments.map((comment) => (
              <li
                key={`${comment.path}:${comment.line}`}
                className="border-t border-line py-2 font-mono text-xs"
              >
                <span className="text-accent">
                  {comment.path}:{comment.line}
                </span>
                <p className="mt-1 whitespace-pre-wrap text-fg-muted">{comment.body}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
