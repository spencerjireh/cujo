import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * The review body is markdown written by the agent, so it is untrusted input
 * rendered into an operator's browser. The allowlist is deliberately small: a
 * review is prose, code, links, and lists.
 *
 * `sanitize` and `renderMarkdown` are browser-only — DOMPurify needs a real
 * DOM. Callers must invoke them after mount, not during render, because Next
 * server-renders client components for the first paint. See ReviewPanel.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const ALLOWED_ATTR = ["href", "title"];

/**
 * Whether a single newline is a line break.
 *
 * False for a review body, which is markdown and means what markdown means: two
 * lines wrapped in a source file are one paragraph. True for the run summary,
 * which the rubric asks for as two lines — the verdict and the counts — and
 * where joining them into one paragraph would lose the only structure it has.
 */
export function toHtml(markdown: string, breaks = false): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks });
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // No data: or javascript: destinations, and no inline event handlers.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
    FORBID_TAGS: ["style", "script", "iframe", "form", "input"],
    FORBID_ATTR: ["style", "srcset", "formaction"],
  });
}

export function renderMarkdown(markdown: string, breaks = false): string {
  return sanitize(toHtml(markdown, breaks));
}
