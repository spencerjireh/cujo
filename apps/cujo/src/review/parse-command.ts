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
 * someone how to use it.
 */

import type { CommandVerb } from "./command-authorization";

export type CommandParse =
  | { kind: "none" }
  | { kind: "command"; verb: CommandVerb }
  /** Both verbs in one comment. Refused rather than guessed at. */
  | { kind: "ambiguous" };

/** `/cujo <verb>`, alone on its line. Nothing after it, so a sentence is not a command. */
const COMMAND = /^\/cujo[ \t]+(confirm|dismiss)[ \t]*$/;
/** ``` or ~~~, any length from three. */
const FENCE = /^\s*(`{3,}|~{3,})/;
/** A quoted line, which is someone repeating a command rather than giving one. */
const QUOTE = /^\s*>/;

/**
 * The verb this comment gives, if any.
 *
 * The line must begin with `/cujo` at column zero. Leading whitespace is not
 * allowed on purpose: four spaces is an indented code block in GitHub's
 * markdown, and a command nobody can see rendered is worse than no command.
 */
export function parseCommand(body: string): CommandParse {
  const verbs = new Set<CommandVerb>();
  let fence: string | null = null;

  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = FENCE.exec(raw);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] ?? "";
      // A fence closes only on its own character, so ``` inside a ~~~ block
      // does not end it.
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (QUOTE.test(raw)) continue;
    const match = COMMAND.exec(raw);
    if (match?.[1]) verbs.add(match[1] as CommandVerb);
  }

  if (verbs.size === 0) return { kind: "none" };
  if (verbs.size > 1) return { kind: "ambiguous" };
  // Exactly one, and `verbs.size === 1` guarantees the iterator yields it.
  const [verb] = verbs;
  return verb ? { kind: "command", verb } : { kind: "none" };
}
