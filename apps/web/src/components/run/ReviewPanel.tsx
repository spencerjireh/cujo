"use client";

import type { DraftedReview } from "@/lib/api/types";
import { renderMarkdown } from "@/lib/markdown";
import { useEffect, useState } from "react";

/**
 * The review as it will appear on GitHub. The body is markdown written by the
 * agent, so it is untrusted: it is parsed and then sanitized against a small
 * allowlist (lib/markdown.ts).
 *
 * Sanitizing runs after mount, never during render. DOMPurify needs a real DOM,
 * and Next server-renders client components for the first paint, so calling it
 * in render throws on the server. Rendering the body as plain text until the
 * effect runs also keeps the server and first client render identical, so there
 * is no hydration mismatch — and the pre-sanitized state is inert text, never
 * markup.
 */
export function ReviewPanel({ review, posted }: { review: DraftedReview; posted: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => setHtml(renderMarkdown(review.body)), [review.body]);
  const blocking = review.tool !== "post_advisory_review";
  const gated = review.tool === "post_gated_review";

  return (
    <section aria-label={gated ? "Held review" : "Review"}>
      <h2 className="mb-3 flex flex-wrap items-center gap-3 text-lg">
        {gated ? "Held for a human" : posted ? "Review" : "Drafted review"}
        <span
          className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${
            blocking ? "bg-sev-critical-bg text-sev-critical" : "bg-sev-info-bg text-sev-info"
          }`}
        >
          {gated ? "request changes — held" : blocking ? "request changes" : "comment"}
        </span>
      </h2>

      {html === null ? (
        <p className="max-w-[68ch] whitespace-pre-wrap text-sm">{review.body}</p>
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
            Inline comments ({review.comments.length})
          </h3>
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
