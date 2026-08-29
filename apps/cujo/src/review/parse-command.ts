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
const COMMAND = /^\/cujo[ \t]+(confirm|dismiss)[ \t]*$/;

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
 * fenced code, blockquotes and HTML comments removed.
 *
 * Blockquote state is held until a blank line rather than per marked line.
 * CommonMark's lazy continuation (§5.1) keeps an unmarked line inside the
 * quote, so `> they said\n/cujo dismiss` renders wholly as a quotation while a
 * per-line test would read the second line as a command.
 */
export function renderedLines(body: string): string[] {
  const out: string[] = [];
  let fence: Fence | null = null;
  let inQuote = false;
  let inHtmlComment = false;

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (inHtmlComment) {
      if (line.includes("-->")) inHtmlComment = false;
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
    if (BLANK.test(line)) {
      inQuote = false;
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
