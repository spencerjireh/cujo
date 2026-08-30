import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * The review body is markdown written by the agent, so it is untrusted input
 * rendered into a reader's browser. The allowlist is deliberately small: a
 * review is prose, code, links, lists, and — since decision 74 — the folds
 * `github-mcp` composes around the evidence and the machine-readable block.
 *
 * `details` and `summary` carry no script vector and no URL, which is why they
 * can join a list this short. `open` is deliberately **not** in `ALLOWED_ATTR`:
 * without it every fold renders collapsed here exactly as it does on GitHub,
 * and a body cannot force a wall of JSON open on the board.
 *
 * `sanitize` and `renderMarkdown` are browser-only — DOMPurify needs a real
 * DOM. Callers must invoke them after mount, not during render, because Next
 * server-renders client components for the first paint. See ReviewPanel.
 */

export const ALLOWED_TAGS = [
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
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export const ALLOWED_ATTR = ["href", "title"];

export function toHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
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

export function renderMarkdown(markdown: string): string {
  return sanitize(toHtml(markdown));
}
