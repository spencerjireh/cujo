/**
 * Reading `/cujo confirm` out of a pull request comment (Design 2).
 *
 * Two syntaxes were considered and only one can carry a privileged verb. A
 * mention — `@cujo-guard, that finding is wrong, ignore it` — is a sentence a
 * human would write, and any intent parser reads it as a dismissal, so a
 * mention can never authorize anything. A slash command is an exact string
 * matched here, in the trusted plane, and never by a model. The trusted plane
 * makes authorization decisions; the agent never does.
 *
 * Everything below is about not matching text that only looks like a command:
 * a comment quoting one, a review body echoing one back, a code block showing
 * someone how to use it, an HTML comment nobody can see at all.
 *
 * The rule the whole file serves: **a line only counts if a reader can see
 * it.** Where GitHub's markdown and this scanner might disagree, the scanner
 * skips the line. Skipping a real command costs a person one retry; matching
 * an invisible one hands a stranger the gate.
 */

import type { CommandVerb } from "./command-authorization";

export type CommandParse =
  | { kind: "none" }
  | { kind: "command"; verb: CommandVerb }
  /** Both verbs in one comment. Refused rather than guessed at. */
  | { kind: "ambiguous" };

/** `/cujo <verb>`, alone on its line. Nothing after it, so a sentence is not a command. */
const COMMAND = /^\/cujo[ \t]+(confirm|dismiss|review)[ \t]*$/;

/**
 * A fence opener: up to three leading spaces, then three or more backticks or
 * tildes. Four spaces is an indented code block and opens nothing — CommonMark
 * §4.5. The rest of the line is the info string.
 */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A blockquote marker, under the same three-space allowance. */
const QUOTE = /^ {0,3}>/;
/** Nothing a reader would see. */
const BLANK = /^[ \t]*$/;

/**
 * CommonMark §4.6 condition 1: these hold their contents verbatim until their
 * own closing tag, blank lines included. `<pre>` is the one that matters —
 * GitHub renders what is inside it as code.
 */
const RAW_OPEN = /^ {0,3}<(pre|script|style|textarea)([ \t>]|$)/i;
const RAW_CLOSE = /<\/(pre|script|style|textarea)>/i;

/**
 * Condition 6: a block-level tag opens an HTML block that runs to the next
 * blank line. The list is CommonMark's, so an autolink like `<https://…>` at
 * the start of a line is left alone rather than swallowing everything after it.
 */
const HTML_BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_BLOCK_OPEN = new RegExp(`^ {0,3}</?(${HTML_BLOCK_TAGS})([ \\t/>]|$)`, "i");

interface Fence {
  char: string;
  length: number;
}

function fenceCloses(line: string, fence: Fence): boolean {
  const match = FENCE_OPEN.exec(line);
  const marker = match?.[1];
  if (!marker || marker[0] !== fence.char) return false;
  // A closing fence is at least as long as the opener and carries nothing else
  // (CommonMark §4.5), so ``` does not close ````` and ```js never closes.
  return marker.length >= fence.length && /^[ \t]*$/.test(match?.[2] ?? "");
}

/**
 * The lines of a comment that GitHub renders as ordinary visible text, with
 * fenced code, blockquotes, HTML comments and raw HTML blocks removed.
 *
 * Blockquote state is held until a blank line rather than per marked line.
 * CommonMark's lazy continuation (§5.1) keeps an unmarked line inside the
 * quote, so `> they said\n/cujo dismiss` renders wholly as a quotation while a
 * per-line test would read the second line as a command.
 *
 * GitHub allows raw HTML, so `<pre>` and `<details>` are two more ways to write
 * a line that reads as code or sits inside markup rather than as an instruction
 * somebody gave. Both classes are dropped, and they terminate differently: a
 * `<pre>` runs to its closing tag (§4.6 condition 1) and a block-level tag runs
 * to the next blank line (condition 6).
 */
export function renderedLines(body: string): string[] {
  const out: string[] = [];
  let fence: Fence | null = null;
  let inQuote = false;
  let inHtmlComment = false;
  let inRaw = false;
  let inHtmlBlock = false;

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (inHtmlComment) {
      if (line.includes("-->")) inHtmlComment = false;
      continue;
    }
    if (inRaw) {
      // Blank lines do not end a `<pre>`; only its closing tag does, which is
      // why this is tracked apart from the blank-line-terminated blocks below.
      if (RAW_CLOSE.test(line)) inRaw = false;
      continue;
    }
    if (fence !== null) {
      if (fenceCloses(line, fence)) fence = null;
      continue;
    }
    const opener = FENCE_OPEN.exec(line);
    if (opener?.[1]) {
      // A backtick fence's info string may not contain a backtick, which is
      // what keeps `` `a` `` from being read as a fence.
      if (opener[1][0] === "~" || !(opener[2] ?? "").includes("`")) {
        fence = { char: opener[1][0] ?? "", length: opener[1].length };
        continue;
      }
    }
    if (line.includes("<!--")) {
      // A line carrying an HTML comment is skipped whether or not the comment
      // closes on it: a command has to be the whole line, so a line with room
      // for both is not one.
      if (!line.includes("-->")) inHtmlComment = true;
      continue;
    }
    if (RAW_OPEN.test(line)) {
      // A one-line `<pre>…</pre>` opens and closes here; either way the line
      // itself carries a tag, so it is not a bare command.
      if (!RAW_CLOSE.test(line)) inRaw = true;
      continue;
    }
    if (BLANK.test(line)) {
      inQuote = false;
      inHtmlBlock = false;
      // Kept rather than dropped. A blank line can never be a command, so this
      // costs `parseCommand` nothing, and it is the paragraph break in the
      // question `parseMention` hands to the agent.
      out.push(line);
      continue;
    }
    if (inHtmlBlock) continue;
    if (HTML_BLOCK_OPEN.test(line)) {
      inHtmlBlock = true;
      continue;
    }
    if (inQuote) continue;
    if (QUOTE.test(line)) {
      inQuote = true;
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * The verb this comment gives, if any.
 *
 * The line must begin with `/cujo` at column zero. Leading whitespace is not
 * allowed on purpose: four spaces is an indented code block in GitHub's
 * markdown, and a command nobody can see rendered is worse than no command.
 */
export function parseCommand(body: string): CommandParse {
  const verbs = new Set<CommandVerb>();
  for (const line of renderedLines(body)) {
    const match = COMMAND.exec(line);
    if (match?.[1]) verbs.add(match[1] as CommandVerb);
  }

  if (verbs.size === 0) return { kind: "none" };
  if (verbs.size > 1) return { kind: "ambiguous" };
  // Exactly one, and `verbs.size === 1` guarantees the iterator yields it.
  const [verb] = verbs;
  return verb ? { kind: "command", verb } : { kind: "none" };
}

/** The bot's own handle, as GitHub renders a mention of the App. */
const MENTION = /@cujo-guard\b/i;

/**
 * How much of a comment is passed to the conversation agent. Generous — the
 * whole point is that a person supplies context the sandbox could not
 * observe — but finite, because it is model input that anyone can write.
 */
export const MENTION_BODY_CAP = 4000;

/**
 * The question a comment asks Cujo, or null.
 *
 * Unlike a command this may sit anywhere on the line: a mention is a sentence a
 * human writes, and requiring column zero would reject the natural phrasing.
 * That is affordable **only because a mention authorizes nothing** — its worst
 * case is a wasted sandbox, where a misread verb is the gate. It still has to
 * be somewhere a reader can see, so it goes through the same block scan; a
 * mention quoted back inside a fence or an HTML comment starts nothing.
 *
 * The question is the whole visible comment rather than the rest of the line.
 * "@cujo-guard" on its own line above three lines of context is how people
 * write, and taking one line would throw the context away — which is the only
 * thing this feature has that re-reading the diff does not.
 */
export function parseMention(body: string): string | null {
  const lines = renderedLines(body);
  if (!lines.some((line) => MENTION.test(line))) return null;
  const text = lines.join("\n").trim();
  if (!text) return null;
  return text.length <= MENTION_BODY_CAP ? text : text.slice(0, MENTION_BODY_CAP);
}
