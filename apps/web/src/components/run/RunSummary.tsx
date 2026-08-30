"use client";

import { renderMarkdown } from "@/lib/markdown";
import { useEffect, useState } from "react";

/**
 * What the run said about itself, at the top of the page.
 *
 * `summary` is the parent thread's last message with no tool call in it, and
 * `agent/SKILL.md` asks for it as two lines: the verdict, and the findings by
 * severity. It was rendered as a bare string, so a model that wrote `**blocks
 * the merge**` — which is markdown asking for emphasis, in a file that is
 * markdown everywhere else it lands — put four asterisks on the page, and the
 * two lines it is asked for collapsed into one paragraph.
 *
 * So it is markdown, on the same terms the review body is (`lib/markdown.ts`):
 * parsed, then sanitized against a small allowlist, and never rendered as
 * markup until after mount — DOMPurify needs a real DOM, and Next
 * server-renders client components for the first paint. Until the effect runs
 * this is the inert source text, which is also what a reader with no JavaScript
 * keeps. `breaks` is on, unlike the review: the rubric asks for two lines and
 * markdown's own rule would join them.
 *
 * It is its own client component so the header around it does not have to be
 * one. Everything else in `RunHeader` renders on the server.
 */
export function RunSummary({ summary }: { summary: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => setHtml(renderMarkdown(summary, true)), [summary]);

  if (html === null) {
    return <p className="mt-4 max-w-[68ch] whitespace-pre-wrap text-sm">{summary}</p>;
  }
  return (
    <div
      className="cujo-prose mt-4 max-w-[68ch] text-sm"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized in lib/markdown.ts
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
